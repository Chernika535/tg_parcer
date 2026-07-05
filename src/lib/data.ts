import { supabase, appConfig, getAccessToken } from "./supabase.ts";

// Вызов edge-функции Supabase ПО ОСНОВНОМУ домену (/functions/v1/<name>).
// ВАЖНО для России: supabase-js по умолчанию шлёт запросы на отдельный поддомен
// <ref>.functions.supabase.co, который в РФ часто заблокирован, тогда как
// основной <ref>.supabase.co доступен. Поэтому ходим напрямую fetch'ем.
// Один заход запроса с таймаутом, КОТОРЫЙ ПОКРЫВАЕТ И ЧТЕНИЕ ТЕЛА. Это важно:
// раньше abort снимался после получения заголовков, а res.json() на нестабильной
// сети (без VPN) мог висеть бесконечно → «Загрузка… часами».
async function fetchJson(url: string, init: RequestInit, ms: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const data = await res.json().catch(() => ({})); // тело тоже под таймаутом
    if (!res.ok) throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`);
    return data;
  } catch (e) {
    throw new Error((e as Error).name === "AbortError" ? "сервер не ответил вовремя" : (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

export async function invokeFn(name: string, body: Record<string, unknown>, timeoutMs = 20000): Promise<unknown> {
  const cfg = appConfig();
  const base = cfg.supabaseUrl.replace(/\/$/, "");
  const token = getAccessToken();
  const url = `${base}/functions/v1/${name}?apikey=${encodeURIComponent(cfg.supabaseAnonKey)}`;
  const headers: Record<string, string> = { "content-type": "text/plain;charset=UTF-8" };
  if (token) headers["authorization"] = `Bearer ${token}`;
  return fetchJson(url, { method: "POST", headers, body: JSON.stringify(body) }, timeoutMs);
}

// GET-вариант вызова функции. Делаем до 2 попыток — связь с Supabase без VPN
// бывает нестабильной (тело ответа иногда «застревает»), повтор часто помогает.
export async function invokeFnGet(name: string, params: Record<string, string>): Promise<unknown> {
  const cfg = appConfig();
  const base = cfg.supabaseUrl.replace(/\/$/, "");
  const token = getAccessToken();
  const q = new URLSearchParams({ apikey: cfg.supabaseAnonKey, ...params });
  const url = `${base}/functions/v1/${name}?${q.toString()}`;
  const init: RequestInit = { method: "GET", headers: token ? { authorization: `Bearer ${token}` } : {} };
  // Связь с Supabase без VPN нестабильна / прижата провайдером — делаем
  // несколько попыток с паузами (паузы важны: без них повторы попадают под тот
  // же троттлинг, что и первый запрос).
  let lastErr: unknown;
  const delays = [0, 1200, 2500, 4000];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
    try {
      return await fetchJson(url, init, 13000);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("сервер не ответил");
}

// Вызов MTProto-операции: если задан mtBaseUrl (Deno Deploy) — идём туда,
// иначе — edge-функция Supabase того же имени (по основному домену).
async function mtCall(name: "tg-connect" | "read-mt" | "react", body: Record<string, unknown>, timeoutMs = 20000): Promise<unknown> {
  const base = appConfig().mtBaseUrl?.replace(/\/$/, "");
  if (base) {
    const { data: s } = await supabase().auth.getSession();
    const res = await fetch(`${base}/${name}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(s.session ? { authorization: `Bearer ${s.session.access_token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
    return data;
  }
  return invokeFn(name, body, timeoutMs);
}

export type Visibility = "private" | "public";
export type FeedStatus = "pending" | "approved" | "rejected";

export type Feed = {
  id: number;
  owner_id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  author_name: string | null;
  channels: string[];
  tags: string[];
  visibility: Visibility;
  status: FeedStatus;
  official: boolean;
  by_admin: boolean;
  reject_reason: string | null;
  created_at: string;
  owner?: { display_name: string | null; username: string | null } | null;
};

export function cleanTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
}

export type Media =
  | { type: "photo"; url: string }
  | { type: "video"; url?: string; thumb?: string }
  | { type: "roundvideo"; url?: string; thumb?: string }
  | { type: "voice"; url?: string }
  | { type: "audio"; url?: string; title?: string; performer?: string }
  | { type: "sticker"; url: string }
  | { type: "document"; title: string; extra?: string }
  | { type: "link"; href?: string; site?: string; title?: string; description?: string; image?: string }
  | { type: "unsupported" };

export type Post = {
  channel: string;
  msgId: number;
  postedAt: string;
  text: string;
  hasMedia: boolean;
  media: Media[];
  link: string;
  views?: string;
  channelTitle?: string;
  channelAvatar?: string;
  folder?: string | null; // папка избранного (только для сохранённых постов)
};

function db() {
  return supabase();
}

// ---- Ленты текущего пользователя (через функцию — надёжно через прокси) ----
export async function myFeeds(): Promise<Feed[]> {
  const d = (await invokeFn("myfeeds", { action: "list_mine" })) as { feeds?: Feed[]; error?: string };
  if (d.error) throw new Error(d.error);
  return d.feeds ?? [];
}

// ---- Одобренные публичные ленты (доступны без входа) ----
// Читаем через edge-функцию (REST-домен в РФ без VPN недоступен).
export async function publicFeeds(): Promise<Feed[]> {
  return (await loadPublic()).feeds;
}
// Публичные ленты + закрепления (для сортировки «закреплённые сверху»).
export async function loadPublic(): Promise<{ feeds: Feed[]; pins: Pin[] }> {
  const d = (await invokeFnGet("feeds", { action: "public" })) as { feeds?: Feed[]; pins?: Pin[]; error?: string };
  if (d.error) throw new Error(d.error);
  return { feeds: d.feeds ?? [], pins: d.pins ?? [] };
}

export async function getFeedById(id: number): Promise<Feed | null> {
  // Публичная лента — через GET-функцию (работает без VPN).
  try {
    const d = (await invokeFnGet("feeds", { action: "get", id: String(id) })) as { feed?: Feed | null; error?: string };
    if (!d.error && d.feed) return d.feed;
  } catch {
    /* пробуем ниже */
  }
  // Своя/любая (для админа) приватная лента — через функцию по JWT.
  if (getAccessToken()) {
    try {
      const d = (await invokeFn("myfeeds", { action: "get_any", id })) as { feed?: Feed | null };
      if (d.feed) return d.feed;
    } catch { /* пробуем ниже */ }
  }
  // Надёжный запасной путь: берём из общего списка публичных лент (та же функция,
  // что работает на главной/в списке лент) — на случай сбоя точечного get.
  try {
    const { feeds } = await loadPublic();
    return feeds.find((f) => f.id === id) ?? null;
  } catch {
    return null;
  }
}

export type FeedInput = {
  title: string;
  description?: string | null;
  cover_url?: string | null;
  author_name?: string | null;
  channels?: string[];
  visibility: Visibility;
  tags?: string[];
  official?: boolean;
  by_admin?: boolean;
};

export async function createFeed(input: FeedInput): Promise<Feed> {
  const payload = {
    title: input.title.trim(),
    description: input.description?.slice(0, 300) || null,
    cover_url: input.cover_url || null,
    author_name: input.author_name?.trim() || null,
    channels: input.channels ?? [],
    visibility: input.visibility,
    tags: cleanTags(input.tags),
    official: !!input.official,
    by_admin: !!input.by_admin,
  };
  const d = (await invokeFn("myfeeds", { action: "create", input: payload })) as { feed?: Feed; error?: string };
  if (d.error) throw new Error(d.error);
  return d.feed as Feed;
}

export async function updateFeed(
  id: number,
  fields: Partial<Pick<Feed, "title" | "description" | "cover_url" | "author_name" | "channels" | "visibility" | "tags" | "official" | "by_admin">>,
): Promise<void> {
  const patch: Record<string, unknown> = { ...fields };
  if (patch.tags) patch.tags = cleanTags(patch.tags as string[]);
  if (typeof patch.description === "string") patch.description = (patch.description as string).slice(0, 300) || null;
  const d = (await invokeFn("myfeeds", { action: "update", id, fields: patch })) as { error?: string };
  if (d.error) throw new Error(d.error);
}

// Загрузка обложки в Supabase Storage (bucket "covers"), возвращает публичный URL.
export async function uploadCover(file: File): Promise<string> {
  const { data: u } = await db().auth.getUser();
  if (!u.user) throw new Error("нужен вход");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${u.user.id}/${Date.now()}.${ext}`;
  const { error } = await db().storage.from("covers").upload(path, file, { upsert: true });
  if (error) throw new Error(error.message);
  return db().storage.from("covers").getPublicUrl(path).data.publicUrl;
}

// Админ: пометить/снять «официальный источник».
export async function setOfficial(id: number, value: boolean): Promise<void> {
  const d = (await invokeFn("myfeeds", { action: "set_official", id, value })) as { error?: string };
  if (d.error) throw new Error(d.error);
}

export async function deleteFeed(id: number): Promise<void> {
  const d = (await invokeFn("myfeeds", { action: "delete", id })) as { error?: string };
  if (d.error) throw new Error(d.error);
}

// ---- Модерация (только админ; RLS/триггеры на сервере это гарантируют) ----
export async function pendingFeeds(): Promise<Feed[]> {
  const d = (await invokeFn("myfeeds", { action: "list_pending" })) as { feeds?: Feed[]; error?: string };
  if (d.error) throw new Error(d.error);
  return d.feeds ?? [];
}
// Все публичные ленты (все статусы) — для модерации.
export async function allPublicFeeds(): Promise<Feed[]> {
  const d = (await invokeFn("myfeeds", { action: "list_public_all" })) as { feeds?: Feed[]; error?: string };
  if (d.error) throw new Error(d.error);
  return d.feeds ?? [];
}

export async function moderateFeed(
  id: number,
  decision: "approved" | "rejected",
  reason?: string,
): Promise<void> {
  const d = (await invokeFn("myfeeds", { action: "moderate", id, decision, reason })) as { error?: string };
  if (d.error) throw new Error(d.error);
}

// ---- Избранные посты (через функцию myfeeds — надёжно через прокси) ----
export async function favoriteLinks(): Promise<string[]> {
  if (!getAccessToken()) return [];
  try {
    const d = (await invokeFn("myfeeds", { action: "fav_links" })) as { links?: string[] };
    return d.links ?? [];
  } catch {
    return [];
  }
}

export async function listFavorites(): Promise<Post[]> {
  if (!getAccessToken()) return [];
  const d = (await invokeFn("myfeeds", { action: "fav_list" })) as { posts?: Post[]; error?: string };
  if (d.error) throw new Error(d.error);
  return d.posts ?? [];
}

export async function addFavorite(post: Post): Promise<void> {
  const d = (await invokeFn("myfeeds", { action: "fav_add", input: post as unknown as Record<string, unknown> })) as { error?: string };
  if (d.error) throw new Error(d.error);
}

export async function removeFavorite(link: string): Promise<void> {
  await invokeFn("myfeeds", { action: "fav_remove", input: { link } }).catch(() => {});
}

// Переложить избранный пост в папку (folder=null — «Без папки»).
export async function setFavoriteFolder(link: string, folder: string | null): Promise<void> {
  const d = (await invokeFn("myfeeds", { action: "fav_set_folder", input: { link, folder } })) as { error?: string };
  if (d.error) throw new Error(d.error);
}

// ---- Личные закрепления лент в «Мои» (на сервере, не теряются между входами) ----
export async function myPins(): Promise<number[]> {
  if (!getAccessToken()) return [];
  const d = (await invokeFn("myfeeds", { action: "mypins_list" })) as { ids?: number[] };
  return d.ids ?? [];
}
export async function addMyPin(id: number): Promise<void> {
  await invokeFn("myfeeds", { action: "mypin_add", id }).catch(() => {});
}
export async function removeMyPin(id: number): Promise<void> {
  await invokeFn("myfeeds", { action: "mypin_remove", id }).catch(() => {});
}

// ---- Избранные ЛЕНТЫ ----
export async function feedFavIds(): Promise<number[]> {
  if (!getAccessToken()) return [];
  try {
    const d = (await invokeFn("myfeeds", { action: "ffav_ids" })) as { ids?: number[] };
    return d.ids ?? [];
  } catch {
    return [];
  }
}
export async function favoriteFeeds(): Promise<Feed[]> {
  const d = (await invokeFn("myfeeds", { action: "ffav_list" })) as { feeds?: Feed[]; error?: string };
  if (d.error) throw new Error(d.error);
  return d.feeds ?? [];
}
export async function addFeedFav(id: number): Promise<void> {
  const d = (await invokeFn("myfeeds", { action: "ffav_add", id })) as { error?: string };
  if (d.error) throw new Error(d.error);
}
export async function removeFeedFav(id: number): Promise<void> {
  await invokeFn("myfeeds", { action: "ffav_remove", id }).catch(() => {});
}

// ---- Избранные ТЕГИ ----
export async function favTags(): Promise<string[]> {
  if (!getAccessToken()) return [];
  try {
    const d = (await invokeFn("myfeeds", { action: "tfav_list" })) as { tags?: string[] };
    return d.tags ?? [];
  } catch {
    return [];
  }
}
export async function addFavTag(tag: string): Promise<void> {
  const d = (await invokeFn("myfeeds", { action: "tfav_add", input: { tag } })) as { error?: string };
  if (d.error) throw new Error(d.error);
}
export async function removeFavTag(tag: string): Promise<void> {
  await invokeFn("myfeeds", { action: "tfav_remove", input: { tag } }).catch(() => {});
}

// ---- Закрепления (pins) ----
export type Pin = { feed_id: number; tag: string; rank: number };
export async function pinsList(): Promise<Pin[]> {
  const d = (await invokeFn("myfeeds", { action: "pins_list" })) as { pins?: Pin[]; error?: string };
  if (d.error) throw new Error(d.error);
  return d.pins ?? [];
}
export async function setPin(feed_id: number, tag: string, rank: number): Promise<void> {
  const d = (await invokeFn("myfeeds", { action: "pin_set", input: { feed_id, tag, rank } })) as { error?: string };
  if (d.error) throw new Error(d.error);
}
export async function removePin(feed_id: number, tag: string): Promise<void> {
  await invokeFn("myfeeds", { action: "pin_remove", input: { feed_id, tag } }).catch(() => {});
}

// ---- MTProto: подключение читающего аккаунта (админ) ----
export async function tgStatus(): Promise<boolean> {
  try {
    const d = (await mtCall("tg-connect", { action: "status" })) as { connected?: boolean };
    return !!d.connected;
  } catch {
    return false;
  }
}
export async function tgSendCode(phone: string): Promise<void> {
  const d = (await mtCall("tg-connect", { action: "send_code", phone })) as { error?: string };
  if (d.error) throw new Error(d.error);
}
export async function tgSignIn(
  phone: string,
  code: string,
  password?: string,
): Promise<{ ok?: boolean; need_password?: boolean }> {
  const d = (await mtCall("tg-connect", { action: "sign_in", phone, code, password })) as {
    ok?: boolean;
    need_password?: boolean;
    error?: string;
  };
  if (d.error) throw new Error(d.error);
  return d;
}
export async function tgDisconnect(): Promise<void> {
  await mtCall("tg-connect", { action: "disconnect" }).catch(() => {});
}
export async function tgSetSession(session: string): Promise<void> {
  const d = (await mtCall("tg-connect", { action: "set_session", session })) as { error?: string };
  if (d.error) throw new Error(d.error);
}
// Профиль текущего пользователя — через функцию (надёжнее, чем REST через прокси).
export async function getMyProfile(): Promise<unknown> {
  const d = (await mtCall("tg-connect", { action: "profile" })) as { profile?: unknown };
  return d.profile ?? null;
}
// Обновление профиля (имя/аватар) — через функцию по JWT.
export async function updateMyProfile(fields: { display_name?: string; photo_url?: string }): Promise<void> {
  const d = (await invokeFn("myfeeds", { action: "update_profile", input: fields })) as { error?: string };
  if (d.error) throw new Error(d.error);
}
// Загрузка аватарки (в bucket covers), возвращает публичный URL.
export async function uploadAvatar(file: File): Promise<string> {
  return uploadCover(file);
}
// Загрузка медиа для поста (в тот же публичный bucket) — бот шлёт в Telegram по URL.
export async function uploadMedia(file: File | Blob, ext = "bin"): Promise<string> {
  const name = file instanceof File ? file.name : `rec.${ext}`;
  return uploadCover(new File([file], name, { type: (file as File).type || "application/octet-stream" }));
}

// ---- Кабинет автора: постинг в свои каналы через бота ----
export type AuthorChannel = { id: number; chat_id: string; username: string | null; title: string | null };
export type PostMedia = {
  type: "photo" | "video" | "voice" | "audio" | "document" | "videonote";
  url: string;
  name?: string;      // имя файла (для document)
  title?: string;     // название трека (для audio)
  performer?: string; // исполнитель (для audio)
};
export type ScheduledPost = {
  id: number; chat_id: string; text: string | null; parse_mode: string | null;
  media: PostMedia[]; disable_preview: boolean; publish_at: string; status: string; error: string | null;
};
export type ComposePayload = {
  chat_id: string; text?: string; parse_mode?: string | null; media?: PostMedia[]; disable_preview?: boolean;
};

export async function verifyChannel(channel: string): Promise<{ chat_id: string; title?: string; username?: string; description?: string }> {
  const d = (await invokeFn("bot", { action: "verify", channel })) as { error?: string } & Record<string, unknown>;
  if (d.error) throw new Error(d.error);
  return d as { chat_id: string; title?: string; username?: string; description?: string };
}
export async function linkChannel(channel: string): Promise<void> {
  const d = (await invokeFn("bot", { action: "link", channel })) as { error?: string };
  if (d.error) throw new Error(d.error);
}
export async function authorChannels(): Promise<AuthorChannel[]> {
  const d = (await invokeFn("bot", { action: "list" })) as { channels?: AuthorChannel[]; error?: string };
  if (d.error) throw new Error(d.error);
  return d.channels ?? [];
}
export async function unlinkChannel(id: number): Promise<void> {
  await invokeFn("bot", { action: "unlink", id }).catch(() => {});
}
export async function sendPostNow(input: ComposePayload): Promise<void> {
  const d = (await invokeFn("bot", { action: "send", input }, 40000)) as { error?: string };
  if (d.error) throw new Error(d.error);
}
export async function schedulePost(input: ComposePayload & { publish_at: string }): Promise<void> {
  const d = (await invokeFn("bot", { action: "schedule", input })) as { error?: string };
  if (d.error) throw new Error(d.error);
}
export async function scheduledPosts(): Promise<ScheduledPost[]> {
  const d = (await invokeFn("bot", { action: "scheduled_list" })) as { posts?: ScheduledPost[]; error?: string };
  if (d.error) throw new Error(d.error);
  return d.posts ?? [];
}
export async function cancelScheduled(id: number): Promise<void> {
  await invokeFn("bot", { action: "scheduled_cancel", id }).catch(() => {});
}
export async function updateScheduled(id: number, input: ComposePayload & { publish_at: string }): Promise<void> {
  const d = (await invokeFn("bot", { action: "scheduled_update", id, input })) as { error?: string };
  if (d.error) throw new Error(d.error);
}

// ---- Уже опубликованные через сервис посты (правка текста/удаление) ----
export type PostedMessage = {
  id: number; chat_id: string; message_ids: number[]; text_message_id: number | null;
  is_caption: boolean; text: string | null; parse_mode: string | null; sent_at: string;
};
export async function postedList(): Promise<PostedMessage[]> {
  const d = (await invokeFn("bot", { action: "posted_list" })) as { posts?: PostedMessage[]; error?: string };
  if (d.error) throw new Error(d.error);
  return d.posts ?? [];
}
export async function editPosted(id: number, text: string): Promise<void> {
  const d = (await invokeFn("bot", { action: "post_edit", id, input: { text, parse_mode: "HTML" } })) as { error?: string };
  if (d.error) throw new Error(d.error);
}
export async function deletePosted(id: number): Promise<{ warning?: string }> {
  const d = (await invokeFn("bot", { action: "post_delete", id })) as { error?: string; warning?: string };
  if (d.error) throw new Error(d.error);
  return { warning: d.warning };
}
export async function updateChannelInfo(input: { chat_id: string; title?: string; description?: string; photo_url?: string }): Promise<void> {
  const d = (await invokeFn("bot", { action: "channel_update", input }, 40000)) as { error?: string };
  if (d.error) throw new Error(d.error);
}

// Строка сессии читающего аккаунта — для чтения закрытых каналов в браузере.
export async function getReadSession(): Promise<string | null> {
  const d = (await mtCall("tg-connect", { action: "get_session" })) as { session?: string | null; error?: string };
  if (d.error) throw new Error(d.error);
  return d.session ?? null;
}

// Серверное чтение закрытых каналов (read-mt на Supabase). Работает БЕЗ VPN у
// пользователя, т.к. в Telegram ходит сервер, а не браузер. Может не завестись
// на edge (тогда клиент откатывается на браузерное чтение).
export async function readChannelsMTServer(
  channels: string[],
): Promise<{ posts: Post[]; unavailable: string[]; noAccount?: boolean; error?: string; note?: string }> {
  if (channels.length === 0) return { posts: [], unavailable: [] };
  try {
    // read-mt на edge читает Telegram и качает медиа — даём ему больше времени (30с).
    return (await mtCall("read-mt", { channels }, 30000)) as {
      posts: Post[];
      unavailable: string[];
      noAccount?: boolean;
      error?: string;
      note?: string;
    };
  } catch (e) {
    return { posts: [], unavailable: channels, error: (e as Error).message };
  }
}

// Статистика канала для его автора (иначе — null).
export type ChannelStats = { favorites: number; privateFeeds: number; likesTotal: number; likesByLink: Record<string, number> };
export async function channelStats(username: string): Promise<ChannelStats | null> {
  try {
    const d = (await invokeFn("bot", { action: "channel_stats", input: { username } })) as { stats?: ChannelStats | null };
    return d.stats ?? null;
  } catch {
    return null;
  }
}

// Все каналы (для админа): ник + в скольких лентах встречается.
export async function allChannels(): Promise<{ username: string; feeds: number }[]> {
  const d = (await invokeFn("bot", { action: "all_channels" })) as { channels?: { username: string; feeds: number }[]; error?: string };
  if (d.error) throw new Error(d.error);
  return d.channels ?? [];
}

// ---- Локальные лайки постов ----
export async function likeLinks(): Promise<string[]> {
  if (!getAccessToken()) return [];
  const d = (await invokeFn("myfeeds", { action: "like_links" })) as { links?: string[] };
  return d.links ?? [];
}
export async function addLike(link: string, channel: string): Promise<void> {
  await invokeFn("myfeeds", { action: "like_add", input: { link, channel } }).catch(() => {});
}
export async function removeLike(link: string): Promise<void> {
  await invokeFn("myfeeds", { action: "like_remove", input: { link } }).catch(() => {});
}

// Закреплённый пост канала (через общий читающий аккаунт, MTProto).
export async function pinnedPost(channel: string): Promise<Post | null> {
  try {
    const d = (await mtCall("read-mt", { pinned: { channel } }, 30000)) as { post?: Post | null };
    return d.post ?? null;
  } catch {
    return null;
  }
}
// Закрепить/открепить пост в своём канале (бот — админ). chatId — из author_channels.
export async function pinPost(chatId: string, messageId: number): Promise<void> {
  const d = (await invokeFn("bot", { action: "pin", input: { chat_id: chatId, message_id: messageId } })) as { error?: string };
  if (d.error) throw new Error(d.error);
}
export async function unpinPost(chatId: string, messageId: number): Promise<void> {
  const d = (await invokeFn("bot", { action: "unpin", input: { chat_id: chatId, message_id: messageId } })) as { error?: string };
  if (d.error) throw new Error(d.error);
}

// Догрузка одного крупного видео/медиа по channel+msgId (через общий аккаунт).
export async function loadPostMedia(channel: string, msgId: number): Promise<{ url?: string; tooBig?: boolean; error?: string }> {
  try {
    return (await mtCall("read-mt", { one: { channel, msgId } }, 60000)) as { url?: string; tooBig?: boolean; error?: string };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function readChannelsMT(
  channels: string[],
  onPost?: (p: Post) => void,
): Promise<{ posts: Post[]; unavailable: string[]; noAccount?: boolean; error?: string; note?: string }> {
  if (channels.length === 0) return { posts: [], unavailable: [] };
  // Чтение идёт в браузере (GramJS), а не на edge — там пакет telegram
  // крэшит изолят на импорте. Импортируем модуль лениво.
  try {
    const { readChannelsMT: readBrowser } = await import("./tgRead.ts");
    return await readBrowser(channels, onPost);
  } catch (e) {
    return { posts: [], unavailable: channels, error: (e as Error).message };
  }
}

// ---- Чтение каналов через серверную edge-функцию ----
export async function readChannels(
  channels: string[],
): Promise<{ posts: Post[]; unavailable: string[] }> {
  if (channels.length === 0) return { posts: [], unavailable: [] };
  // GET: каналы через query. imgbase — чтобы картинки-прокси указывали на тот же
  // адрес, что использует клиент (Onreza /sb или напрямую Supabase).
  const data = await invokeFnGet("read-channels", {
    channels: channels.join(","),
    imgbase: appConfig().supabaseUrl,
  });
  return data as { posts: Post[]; unavailable: string[] };
}

// Подгрузка более ранних постов («ещё посты»): для каждого канала — окно старше
// его самого старого уже показанного msgId. Работает для открытых каналов (t.me/s).
export async function readChannelsBefore(
  cursors: { channel: string; before: number }[],
): Promise<{ posts: Post[] }> {
  if (cursors.length === 0) return { posts: [] };
  try {
    const data = (await invokeFn("read-channels", {
      cursors,
      imgbase: appConfig().supabaseUrl,
    }, 25000)) as { posts?: Post[] };
    return { posts: data.posts ?? [] };
  } catch {
    return { posts: [] };
  }
}

export type ChannelInfo = {
  username: string;
  title?: string;
  avatar?: string;
  description?: string;
  subscribers?: string;
};

// Мета-инфо о каналах (без постов): название, ник, аватар, описание из их ТГ.
export async function channelsInfo(channels: string[]): Promise<ChannelInfo[]> {
  if (channels.length === 0) return [];
  try {
    const data = (await invokeFnGet("read-channels", {
      channels: channels.join(","),
      imgbase: appConfig().supabaseUrl,
      info: "1",
    })) as { channels?: ChannelInfo[] };
    return data.channels ?? [];
  } catch {
    return [];
  }
}

// ---- Аналитика (обезличенные события; сводка — только админ) ----

// Устойчивый анонимный id браузера — чтобы считать УНИКАЛЬНЫХ посетителей,
// не привязываясь к личности.
function analyticsSid(): string {
  try {
    let s = localStorage.getItem("tf_sid");
    if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("tf_sid", s); }
    return s;
  } catch { return "anon"; }
}

// Записать просмотр. Дедуплицируем по «вид:цель:день», чтобы один браузер
// считался раз в сутки на цель (меньше запросов, чище цифры). Fire-and-forget.
export function track(kind: "site" | "feed" | "channel" | "post", target?: string): void {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const key = `${kind}:${target ?? ""}:${day}`;
    const raw = localStorage.getItem("tf_trk");
    const seen: Record<string, number> = raw ? JSON.parse(raw) : {};
    if (seen[key]) return;
    seen[key] = 1;
    const keys = Object.keys(seen);
    localStorage.setItem("tf_trk", keys.length > 3000 ? "{}" : JSON.stringify(seen));
  } catch { /* приватный режим — просто отправим без дедупа */ }
  invokeFn("analytics", { action: "track", kind, target, session: analyticsSid() }, 5000).catch(() => {});
}

export type RankRow = { target: string; views: number; uniques: number; title?: string };
export type AdminStats = {
  days: number;
  visitors: { views: number; uniques: number };
  feedViews: { views: number; uniques: number };
  channelViews: { views: number; uniques: number };
  postViews: { views: number; uniques: number };
  newUsers: number; newAuthors: number; newChannels: number;
  postsPublished: number; newFavorites: number; newLikes: number;
  totalUsers: number; totalChannels: number;
  topFeeds: RankRow[]; topChannels: RankRow[]; topPosts: RankRow[];
};

export async function adminAnalytics(days: number): Promise<AdminStats> {
  const d = (await invokeFn("analytics", { action: "stats", days })) as { stats?: AdminStats; error?: string };
  if (!d.stats) throw new Error(d.error || "нет данных");
  return d.stats;
}
