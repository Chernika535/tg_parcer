// Кабинет автора: постинг в каналы через Telegram Bot API. Пользователь добавляет
// нашего бота админом в свой канал — сервер (вне РФ) шлёт посты, автору VPN не нужен.
// Привязать канал можно только если бот там админ с правом публикации И сам автор —
// админ/создатель канала (проверяем через getChatMember). Всё под JWT автора (RLS).
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { makeSender, type Media } from "../_shared/send.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, "content-type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

function normCh(c: string): string {
  return c.trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^t\.me\//, "").replace(/^s\//, "").replace(/^@/, "")
    .split(/[/?#]/)[0].replace(/[^a-z0-9_]/g, "");
}

async function tg(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: any; description?: string }> {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return await r.json();
}

const sendPost = makeSender(BOT_TOKEN, SUPABASE_URL);

// Медиа композера → форма читателя (как в постах ленты). Ссылки уже наши (Storage).
// deno-lint-ignore no-explicit-any
function mediaForReader(media: Media[]): Record<string, unknown>[] {
  return (media ?? []).map((m) => {
    if (m.type === "videonote") return { type: "roundvideo", url: m.url };
    if (m.type === "audio") return { type: "audio", url: m.url, title: m.title, performer: m.performer };
    if (m.type === "document") return { type: "document", title: m.name || "файл", url: m.url };
    // photo | video | voice — как есть
    return { type: m.type, url: m.url };
  });
}

// Сохраняем опубликованный пост в наш архив (страница канала переживёт Telegram).
// Пишем под service role — таблица публична на чтение, запись только сервером.
async function archivePost(_db: unknown, ownerId: string, chatId: string, msgId: number, text: string, media: Media[], disablePreview: boolean): Promise<void> {
  if (!SERVICE_ROLE) return;
  try {
    const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: ch } = await svc.from("author_channels").select("username").eq("chat_id", chatId).maybeSingle();
    await svc.from("archived_posts").upsert({
      owner_id: ownerId,
      chat_id: chatId,
      username: ch?.username ? normCh(ch.username) : null,
      msg_id: msgId,
      posted_at: new Date().toISOString(),
      text: text || null,
      media: mediaForReader(media),
      disable_preview: disablePreview,
      source: "publish",
    }, { onConflict: "chat_id,msg_id" });
  } catch { /* архив — best-effort, публикацию не ломаем */ }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!BOT_TOKEN) return json({ error: "бот не настроен (TELEGRAM_BOT_TOKEN)" }, 500);
    const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!jwt) return json({ error: "нужен вход" }, 401);
    const db = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false },
    });
    const { data: u } = await db.auth.getUser();
    if (!u.user) return json({ error: "нужен вход" }, 401);
    const uid = u.user.id;

    const b = (await req.json()) as {
      action: string;
      channel?: string;
      chat_id?: string;
      id?: number;
      input?: Record<string, unknown>;
    };

    // Telegram-id автора — для проверки, что он сам админ канала.
    const { data: prof } = await db.from("profiles").select("telegram_id").eq("id", uid).maybeSingle();
    const myTgId = prof?.telegram_id as number | null;

    const botId = BOT_TOKEN.split(":")[0];

    // Проверка канала: бот — админ с правом публикации, автор — админ/создатель.
    async function inspect(channel: string) {
      const chatRef = /^-?\d+$/.test(channel.trim()) ? channel.trim() : "@" + channel.trim().replace(/^@/, "");
      const chat = await tg("getChat", { chat_id: chatRef });
      if (!chat.ok) return { error: chat.description || "канал не найден" };
      const chatId = String(chat.result.id);
      const botM = await tg("getChatMember", { chat_id: chatId, user_id: Number(botId) });
      const botAdmin = botM.ok && (botM.result.status === "administrator") && (botM.result.can_post_messages !== false);
      if (!botAdmin) return { error: "бот не админ канала или без права публикации" };
      let userAdmin = false;
      if (myTgId) {
        const uM = await tg("getChatMember", { chat_id: chatId, user_id: myTgId });
        userAdmin = uM.ok && (uM.result.status === "administrator" || uM.result.status === "creator");
      }
      if (!userAdmin) return { error: "вы не админ этого канала (войдите через тот же Telegram)" };
      return {
        chat_id: chatId,
        title: chat.result.title as string | undefined,
        username: chat.result.username as string | undefined,
        description: chat.result.description as string | undefined,
      };
    }

    // Проверка, что канал принадлежит автору (есть в его привязках).
    async function owns(chatId: string): Promise<boolean> {
      const { data } = await db.from("author_channels").select("id").eq("owner_id", uid).eq("chat_id", chatId).maybeSingle();
      return !!data;
    }

    if (b.action === "verify") {
      if (!b.channel) return json({ error: "нет канала" }, 400);
      const r = await inspect(b.channel);
      return "error" in r ? json({ error: r.error }, 400) : json(r);
    }

    // Включить вебхук Telegram одной кнопкой (только админ) — без ручного токена.
    if (b.action === "setup_webhook") {
      const { data: prof } = await db.from("profiles").select("role").eq("id", uid).maybeSingle();
      if (prof?.role !== "admin") return json({ error: "только для админа" }, 403);
      const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";
      const url = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/tg-webhook`;
      const r = await tg("setWebhook", {
        url,
        allowed_updates: ["channel_post", "edited_channel_post"],
        ...(secret ? { secret_token: secret } : {}),
      });
      return r.ok ? json({ ok: true, url }) : json({ error: r.description || "не удалось включить вебхук" }, 400);
    }

    // Соцссылки канала (TikTok / YouTube / подкаст) — задаёт владелец канала.
    if (b.action === "set_social") {
      const inp = (b.input ?? {}) as {
        chat_id?: string; tiktok?: string | null; youtube?: string | null;
        bandlink?: string | null; litres?: string | null;
        boosty?: string | null; vk?: string | null; website?: string | null;
        zen?: string | null; rutube?: string | null; teletype?: string | null;
        music_caption?: string | null; spotify?: string | null; yandexmusic?: string | null; zvuk?: string | null;
        podcast_url?: string | null; podcast_title?: string | null; podcast_cover?: string | null;
      };
      if (!inp.chat_id) return json({ error: "нет канала" }, 400);
      const clean = (v?: string | null) => (v ?? "").trim() || null;
      const patch: Record<string, unknown> = {};
      if (inp.tiktok !== undefined) patch.tiktok_url = clean(inp.tiktok);
      if (inp.youtube !== undefined) patch.youtube_url = clean(inp.youtube);
      if (inp.bandlink !== undefined) patch.bandlink_url = clean(inp.bandlink);
      if (inp.litres !== undefined) patch.litres_url = clean(inp.litres);
      if (inp.boosty !== undefined) patch.boosty_url = clean(inp.boosty);
      if (inp.vk !== undefined) patch.vk_url = clean(inp.vk);
      if (inp.website !== undefined) patch.website_url = clean(inp.website);
      if (inp.zen !== undefined) patch.zen_url = clean(inp.zen);
      if (inp.rutube !== undefined) patch.rutube_url = clean(inp.rutube);
      if (inp.teletype !== undefined) patch.teletype_url = clean(inp.teletype);
      if (inp.music_caption !== undefined) patch.music_caption = clean(inp.music_caption);
      if (inp.spotify !== undefined) patch.spotify_url = clean(inp.spotify);
      if (inp.yandexmusic !== undefined) patch.yandexmusic_url = clean(inp.yandexmusic);
      if (inp.zvuk !== undefined) patch.zvuk_url = clean(inp.zvuk);
      if (inp.podcast_url !== undefined) patch.podcast_url = clean(inp.podcast_url);
      if (inp.podcast_title !== undefined) patch.podcast_title = clean(inp.podcast_title);
      if (inp.podcast_cover !== undefined) patch.podcast_cover = clean(inp.podcast_cover);
      const { data, error } = await db.from("author_channels")
        .update(patch).eq("owner_id", uid).eq("chat_id", inp.chat_id).select("id");
      if (error) return json({ error: error.message }, 500);
      if (!data || data.length === 0) return json({ error: "канал не привязан к вам" }, 403);
      return json({ ok: true });
    }

    if (b.action === "link") {
      if (!b.channel) return json({ error: "нет канала" }, 400);
      const r = await inspect(b.channel);
      if ("error" in r) return json({ error: r.error }, 400);
      const { error } = await db.from("author_channels").upsert(
        { owner_id: uid, chat_id: r.chat_id, username: r.username ?? null, title: r.title ?? null },
        { onConflict: "owner_id,chat_id" },
      );
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, channel: r });
    }

    if (b.action === "list") {
      const { data, error } = await db.from("author_channels").select("*").eq("owner_id", uid).order("created_at");
      if (error) return json({ error: error.message }, 500);
      return json({ channels: data ?? [] });
    }

    if (b.action === "unlink") {
      if (!b.id) return json({ error: "нет id" }, 400);
      await db.from("author_channels").delete().eq("owner_id", uid).eq("id", b.id);
      return json({ ok: true });
    }

    // Обновить сохранённые ник/название канала из Telegram (chat_id не меняется
    // при переименовании — поэтому подтягиваем актуальные @username и title).
    if (b.action === "channel_refresh") {
      const chatId = String(((b.input ?? {}) as { chat_id?: string }).chat_id ?? "");
      if (!chatId || !(await owns(chatId))) return json({ error: "канал не привязан" }, 400);
      const chat = await tg("getChat", { chat_id: chatId });
      if (!chat.ok) return json({ error: chat.description || "не удалось прочитать канал" }, 400);
      const username = (chat.result.username as string | undefined) ?? null;
      const title = (chat.result.title as string | undefined) ?? null;
      const { error } = await db.from("author_channels")
        .update({ username, title }).eq("owner_id", uid).eq("chat_id", chatId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, username, title });
    }

    if (b.action === "send") {
      const p = (b.input ?? {}) as { chat_id?: string; text?: string; parse_mode?: string | null; media?: Media[]; disable_preview?: boolean };
      if (!p.chat_id || !(await owns(p.chat_id))) return json({ error: "канал не привязан" }, 400);
      if (!p.text && !(p.media && p.media.length)) return json({ error: "пустой пост" }, 400);
      const r = await sendPost(p.chat_id, p.text ?? "", p.parse_mode ?? null, p.media ?? [], !!p.disable_preview);
      // Сохраняем id сообщений, чтобы потом можно было отредактировать/удалить.
      if (r.sent && r.sent.messageIds.length) {
        await db.from("posted_messages").insert({
          owner_id: uid, chat_id: p.chat_id, message_ids: r.sent.messageIds,
          text_message_id: r.sent.textMessageId ?? null, is_caption: r.sent.isCaption,
          text: p.text ?? null, parse_mode: p.parse_mode ?? null,
        });
        // Архивируем пост у нас: он останется на странице канала, даже если Telegram ляжет.
        await archivePost(db, uid, p.chat_id, r.sent.messageIds[0], p.text ?? "", p.media ?? [], !!p.disable_preview);
      }
      return r.ok ? json({ ok: true }) : json({ error: r.error || "не удалось отправить" }, 400);
    }

    if (b.action === "posted_list") {
      const { data, error } = await db.from("posted_messages").select("*").eq("owner_id", uid).order("sent_at", { ascending: false }).limit(50);
      if (error) return json({ error: error.message }, 500);
      return json({ posts: data ?? [] });
    }

    if (b.action === "post_edit") {
      if (!b.id) return json({ error: "нет id" }, 400);
      const p = (b.input ?? {}) as { text?: string; parse_mode?: string | null };
      const { data: row } = await db.from("posted_messages").select("*").eq("owner_id", uid).eq("id", b.id).maybeSingle();
      if (!row) return json({ error: "пост не найден" }, 400);
      const mid = row.text_message_id;
      if (!mid) return json({ error: "у этого поста нельзя изменить текст (нет текстового сообщения)" }, 400);
      const pm = p.parse_mode ?? undefined;
      const r = row.is_caption
        ? await tg("editMessageCaption", { chat_id: row.chat_id, message_id: mid, caption: p.text ?? "", parse_mode: pm })
        : await tg("editMessageText", { chat_id: row.chat_id, message_id: mid, text: p.text ?? "", parse_mode: pm });
      if (!r.ok && !/message is not modified/i.test(r.description || "")) return json({ error: r.description }, 400);
      await db.from("posted_messages").update({ text: p.text ?? null, parse_mode: p.parse_mode ?? null }).eq("owner_id", uid).eq("id", b.id);
      return json({ ok: true });
    }

    if (b.action === "post_delete") {
      if (!b.id) return json({ error: "нет id" }, 400);
      const { data: row } = await db.from("posted_messages").select("*").eq("owner_id", uid).eq("id", b.id).maybeSingle();
      if (!row) return json({ error: "пост не найден" }, 400);
      let firstErr = "";
      for (const mid of (row.message_ids ?? []) as number[]) {
        const r = await tg("deleteMessage", { chat_id: row.chat_id, message_id: mid });
        if (!r.ok && !firstErr) firstErr = r.description || "";
      }
      // Из нашего списка убираем в любом случае (в ТГ могло удалиться частично/истечь срок).
      await db.from("posted_messages").delete().eq("owner_id", uid).eq("id", b.id);
      return firstErr ? json({ ok: true, warning: firstErr }) : json({ ok: true });
    }

    if (b.action === "schedule") {
      const p = (b.input ?? {}) as { chat_id?: string; text?: string; parse_mode?: string | null; media?: Media[]; disable_preview?: boolean; publish_at?: string };
      if (!p.chat_id || !(await owns(p.chat_id))) return json({ error: "канал не привязан" }, 400);
      if (!p.publish_at || new Date(p.publish_at).getTime() <= Date.now()) return json({ error: "время публикации должно быть в будущем" }, 400);
      if (!p.text && !(p.media && p.media.length)) return json({ error: "пустой пост" }, 400);
      const { error } = await db.from("scheduled_posts").insert({
        owner_id: uid, chat_id: p.chat_id, text: p.text ?? null, parse_mode: p.parse_mode ?? null,
        media: p.media ?? [], disable_preview: !!p.disable_preview, publish_at: p.publish_at,
      });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (b.action === "scheduled_list") {
      // Отправленные больше не показываем в «запланировано» — они уже в канале.
      const { data, error } = await db.from("scheduled_posts").select("*").eq("owner_id", uid).neq("status", "sent").order("publish_at");
      if (error) return json({ error: error.message }, 500);
      return json({ posts: data ?? [] });
    }

    if (b.action === "scheduled_cancel") {
      if (!b.id) return json({ error: "нет id" }, 400);
      await db.from("scheduled_posts").delete().eq("owner_id", uid).eq("id", b.id);
      return json({ ok: true });
    }

    if (b.action === "scheduled_update") {
      if (!b.id) return json({ error: "нет id" }, 400);
      const p = (b.input ?? {}) as { chat_id?: string; text?: string; parse_mode?: string | null; media?: unknown[]; disable_preview?: boolean; publish_at?: string };
      if (p.chat_id && !(await owns(p.chat_id))) return json({ error: "канал не привязан" }, 400);
      if (p.publish_at && new Date(p.publish_at).getTime() <= Date.now()) return json({ error: "время публикации должно быть в будущем" }, 400);
      if (!p.text && !(p.media && p.media.length)) return json({ error: "пустой пост" }, 400);
      // Обновляем только ЗАПЛАНИРОВАННЫЕ (не отправленные) и снова ставим в очередь.
      const { data, error } = await db.from("scheduled_posts")
        .update({
          chat_id: p.chat_id, text: p.text ?? null, parse_mode: p.parse_mode ?? null,
          media: p.media ?? [], disable_preview: !!p.disable_preview, publish_at: p.publish_at,
          status: "pending", error: null,
        })
        .eq("owner_id", uid).eq("id", b.id).neq("status", "sent").select("id");
      if (error) return json({ error: error.message }, 500);
      if (!data || !data.length) return json({ error: "пост не найден или уже отправлен" }, 400);
      return json({ ok: true });
    }

    // Закрепить/открепить пост — только в каналах, где привязан наш бот (он админ).
    if (b.action === "pin" || b.action === "unpin") {
      const p = (b.input ?? {}) as { chat_id?: string; message_id?: number };
      if (!p.chat_id || !(await owns(p.chat_id))) return json({ error: "канал не привязан" }, 400);
      if (!p.message_id) return json({ error: "нет id сообщения" }, 400);
      const r = b.action === "pin"
        ? await tg("pinChatMessage", { chat_id: p.chat_id, message_id: p.message_id, disable_notification: true })
        : await tg("unpinChatMessage", { chat_id: p.chat_id, message_id: p.message_id });
      return r.ok ? json({ ok: true }) : json({ error: r.description }, 400);
    }

    // Статистика канала — видит его автор ИЛИ администратор сервиса.
    // Считаем по всем пользователям, поэтому нужен service-role (минуя RLS).
    if (b.action === "channel_stats") {
      const uname = normCh(((b.input ?? {}) as { username?: string }).username ?? "");
      if (!uname) return json({ stats: null });
      const { data: mine } = await db.from("author_channels").select("id").eq("owner_id", uid).ilike("username", uname).maybeSingle();
      const { data: prof } = await db.from("profiles").select("role").eq("id", uid).maybeSingle();
      const isAdmin = prof?.role === "admin";
      if (!mine && !isAdmin) return json({ stats: null });
      if (!SERVICE_ROLE) return json({ stats: null });
      const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
      // Постов канала в избранном (у всех пользователей).
      const { count: favCount } = await svc.from("favorites").select("*", { count: "exact", head: true }).eq("data->>channel", uname);
      // В скольких ЛИЧНЫХ подборках есть этот канал.
      const { data: priv } = await svc.from("feeds").select("channels").eq("visibility", "private");
      let inPrivate = 0;
      for (const f of priv ?? []) {
        if (((f.channels ?? []) as string[]).some((c) => normCh(c) === uname)) inPrivate++;
      }
      // Лайки: всего по каналу + разбивка по постам (link → count).
      const { data: likeRows } = await svc.from("post_likes").select("link").eq("channel", uname);
      const likesByLink: Record<string, number> = {};
      for (const r of (likeRows ?? []) as { link: string }[]) likesByLink[r.link] = (likesByLink[r.link] || 0) + 1;
      return json({ stats: { favorites: favCount ?? 0, privateFeeds: inPrivate, likesTotal: (likeRows ?? []).length, likesByLink } });
    }

    // Список всех каналов (для админа) — из всех лент + привязанных авторами.
    if (b.action === "all_channels") {
      const { data: prof } = await db.from("profiles").select("role").eq("id", uid).maybeSingle();
      if (prof?.role !== "admin") return json({ error: "только для админа" }, 403);
      if (!SERVICE_ROLE) return json({ channels: [] });
      const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
      const map = new Map<string, { username: string; feeds: number }>();
      const { data: feeds } = await svc.from("feeds").select("channels");
      for (const f of feeds ?? []) {
        for (const c of ((f.channels ?? []) as string[])) {
          const u = normCh(c);
          if (!u) continue;
          const e = map.get(u) ?? { username: u, feeds: 0 };
          e.feeds++; map.set(u, e);
        }
      }
      const { data: authored } = await svc.from("author_channels").select("username");
      for (const a of authored ?? []) {
        const u = normCh((a.username ?? "") as string);
        if (u && !map.has(u)) map.set(u, { username: u, feeds: 0 });
      }
      const list = [...map.values()].sort((a, b) => b.feeds - a.feeds || a.username.localeCompare(b.username));
      return json({ channels: list });
    }

    // Закреплённый пост канала (для своих каналов — через бота, надёжно).
    if (b.action === "channel_pinned") {
      const p = (b.input ?? {}) as { chat_id?: string };
      if (!p.chat_id) return json({ error: "нет канала" }, 400);
      const r = await tg("getChat", { chat_id: p.chat_id });
      const pm = r.ok ? r.result?.pinned_message : null;
      if (!pm) return json({ pinned: null });
      return json({ pinned: { message_id: pm.message_id, text: pm.text || pm.caption || "" } });
    }

    if (b.action === "channel_update") {
      const p = (b.input ?? {}) as { chat_id?: string; title?: string; description?: string; photo_url?: string };
      if (!p.chat_id || !(await owns(p.chat_id))) return json({ error: "канал не привязан" }, 400);
      const errs: string[] = [];
      if (p.title !== undefined) {
        const r = await tg("setChatTitle", { chat_id: p.chat_id, title: p.title });
        if (!r.ok) errs.push("название: " + r.description);
      }
      if (p.description !== undefined) {
        const r = await tg("setChatDescription", { chat_id: p.chat_id, description: p.description });
        if (!r.ok) errs.push("описание: " + r.description);
      }
      if (p.photo_url) {
        // setChatPhoto требует загрузки файла (URL нельзя) — качаем и шлём multipart.
        try {
          const img = await fetch(p.photo_url);
          const buf = new Uint8Array(await img.arrayBuffer());
          const fd = new FormData();
          fd.append("chat_id", p.chat_id);
          fd.append("photo", new Blob([buf], { type: img.headers.get("content-type") || "image/jpeg" }), "photo.jpg");
          const r = await fetch(`${API}/setChatPhoto`, { method: "POST", body: fd });
          const jr = await r.json();
          if (!jr.ok) errs.push("аватар: " + jr.description);
        } catch (e) {
          errs.push("аватар: " + (e as Error).message);
        }
      }
      return errs.length ? json({ error: errs.join("; ") }, 400) : json({ ok: true });
    }

    return json({ error: "неизвестное действие" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
