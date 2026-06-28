import { supabase, appConfig } from "./supabase.ts";

// Вызов edge-функции Supabase ПО ОСНОВНОМУ домену (/functions/v1/<name>).
// ВАЖНО для России: supabase-js по умолчанию шлёт запросы на отдельный поддомен
// <ref>.functions.supabase.co, который в РФ часто заблокирован, тогда как
// основной <ref>.supabase.co доступен. Поэтому ходим напрямую fetch'ем.
export async function invokeFn(name: string, body: Record<string, unknown>): Promise<unknown> {
  const cfg = appConfig();
  const base = cfg.supabaseUrl.replace(/\/$/, "");
  const { data: s } = await supabase().auth.getSession();
  // ВАЖНО: не шлём Authorization с publishable-ключом (sb_publishable_…) — это не
  // JWT, и шлюз функций отвечает 401. Authorization ставим ТОЛЬКО при реальной
  // пользовательской сессии. Для анонимных вызовов хватает apikey.
  const res = await fetch(`${base}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: cfg.supabaseAnonKey,
      ...(s.session ? { authorization: `Bearer ${s.session.access_token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`);
  return data;
}

// Вызов MTProto-операции: если задан mtBaseUrl (Deno Deploy) — идём туда,
// иначе — edge-функция Supabase того же имени (по основному домену).
async function mtCall(name: "tg-connect" | "read-mt" | "react", body: Record<string, unknown>): Promise<unknown> {
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
  return invokeFn(name, body);
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
  | { type: "sticker"; url: string }
  | { type: "document"; title: string; extra?: string }
  | { type: "link"; href?: string; site?: string; title?: string; description?: string; image?: string };

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
};

function db() {
  return supabase();
}

// ---- Ленты текущего пользователя ----
export async function myFeeds(): Promise<Feed[]> {
  const { data: u } = await db().auth.getUser();
  if (!u.user) return [];
  const { data, error } = await db()
    .from("feeds")
    .select("*")
    .eq("owner_id", u.user.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as Feed[]) ?? [];
}

// ---- Одобренные публичные ленты (доступны без входа) ----
// Читаем через edge-функцию (REST-домен в РФ без VPN недоступен).
export async function publicFeeds(): Promise<Feed[]> {
  const d = (await invokeFn("feeds", { action: "public" })) as { feeds?: Feed[]; error?: string };
  if (d.error) throw new Error(d.error);
  return d.feeds ?? [];
}

export async function getFeedById(id: number): Promise<Feed | null> {
  // Сначала пробуем функцию (работает без VPN для публичных лент).
  try {
    const d = (await invokeFn("feeds", { action: "get", id })) as { feed?: Feed | null; error?: string };
    if (!d.error && d.feed) return d.feed;
    if (!d.error && d.feed === null) {
      // Приватная/чужая лента — добираем через REST под входом (нужен VPN).
      const { data } = await db()
        .from("feeds")
        .select("*, owner:profiles(display_name, username)")
        .eq("id", id)
        .maybeSingle();
      return (data as Feed) ?? null;
    }
  } catch {
    /* падаем на REST ниже */
  }
  const { data, error } = await db()
    .from("feeds")
    .select("*, owner:profiles(display_name, username)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Feed) ?? null;
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
  const { data: u } = await db().auth.getUser();
  if (!u.user) throw new Error("нужен вход");
  const { data, error } = await db()
    .from("feeds")
    .insert({
      owner_id: u.user.id,
      title: input.title.trim(),
      description: input.description?.slice(0, 300) || null,
      cover_url: input.cover_url || null,
      author_name: input.author_name?.trim() || null,
      channels: input.channels ?? [],
      visibility: input.visibility,
      tags: cleanTags(input.tags),
      official: !!input.official,
      by_admin: !!input.by_admin,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Feed;
}

export async function updateFeed(
  id: number,
  fields: Partial<Pick<Feed, "title" | "description" | "cover_url" | "author_name" | "channels" | "visibility" | "tags" | "official" | "by_admin">>,
): Promise<void> {
  const patch: Record<string, unknown> = { ...fields };
  if (patch.tags) patch.tags = cleanTags(patch.tags as string[]);
  if (typeof patch.description === "string") patch.description = (patch.description as string).slice(0, 300) || null;
  const { error } = await db().from("feeds").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
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
  const { error } = await db().from("feeds").update({ official: value }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteFeed(id: number): Promise<void> {
  const { error } = await db().from("feeds").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---- Модерация (только админ; RLS/триггеры на сервере это гарантируют) ----
export async function pendingFeeds(): Promise<Feed[]> {
  const { data, error } = await db()
    .from("feeds")
    .select("*, owner:profiles(display_name, username)")
    .eq("visibility", "public")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as Feed[]) ?? [];
}

export async function moderateFeed(
  id: number,
  decision: "approved" | "rejected",
  reason?: string,
): Promise<void> {
  const { error } = await db()
    .from("feeds")
    .update({ status: decision, reject_reason: reason ?? null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ---- Избранные посты ----
export async function favoriteLinks(): Promise<string[]> {
  const { data: u } = await db().auth.getUser();
  if (!u.user) return [];
  const { data } = await db().from("favorites").select("link").eq("user_id", u.user.id);
  return (data ?? []).map((r: { link: string }) => r.link);
}

export async function listFavorites(): Promise<Post[]> {
  const { data: u } = await db().auth.getUser();
  if (!u.user) return [];
  const { data, error } = await db()
    .from("favorites")
    .select("data")
    .eq("user_id", u.user.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { data: Post }) => r.data);
}

export async function addFavorite(post: Post): Promise<void> {
  const { data: u } = await db().auth.getUser();
  if (!u.user) throw new Error("нужен вход");
  const { error } = await db()
    .from("favorites")
    .upsert({ user_id: u.user.id, link: post.link, data: post });
  if (error) throw new Error(error.message);
}

export async function removeFavorite(link: string): Promise<void> {
  const { data: u } = await db().auth.getUser();
  if (!u.user) return;
  await db().from("favorites").delete().eq("user_id", u.user.id).eq("link", link);
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
    return (await mtCall("read-mt", { channels })) as {
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
  const data = await invokeFn("read-channels", { channels });
  return data as { posts: Post[]; unavailable: string[] };
}
