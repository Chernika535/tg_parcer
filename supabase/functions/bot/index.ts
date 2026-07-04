// Кабинет автора: постинг в каналы через Telegram Bot API. Пользователь добавляет
// нашего бота админом в свой канал — сервер (вне РФ) шлёт посты, автору VPN не нужен.
// Привязать канал можно только если бот там админ с правом публикации И сам автор —
// админ/создатель канала (проверяем через getChatMember). Всё под JWT автора (RLS).
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, "content-type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tg(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: any; description?: string }> {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return await r.json();
}

type Media = { type: "photo" | "video" | "voice" | "audio" | "document"; url: string; name?: string; title?: string; performer?: string };

// Отправка поста в канал: альбом из фото/видео, затем аудио/файлы/голосовые
// отдельными сообщениями. Текст-подпись отдаём первому подходящему медиа, иначе —
// отдельным сообщением. Возвращает {ok} | {error}.
async function sendPost(
  chatId: string,
  text: string,
  parseMode: string | null,
  media: Media[],
  disablePreview: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const pm = parseMode || undefined;
    if (!media.length) {
      const res = await tg("sendMessage", {
        chat_id: chatId, text: text || " ", parse_mode: pm,
        link_preview_options: disablePreview ? { is_disabled: true } : undefined,
      });
      return res.ok ? { ok: true } : { ok: false, error: res.description };
    }

    const visuals = media.filter((m) => m.type === "photo" || m.type === "video");
    const singles = media.filter((m) => m.type === "voice" || m.type === "audio" || m.type === "document");
    let captionUsed = false;
    const cap = () => (!captionUsed && text ? ((captionUsed = true), text) : undefined);
    let firstErr = "";
    const fail = (d?: string) => { if (!firstErr && d) firstErr = d; };

    // 1) Фото/видео — альбомом (или одиночно).
    if (visuals.length === 1) {
      const m = visuals[0];
      const method = m.type === "photo" ? "sendPhoto" : "sendVideo";
      const key = m.type === "photo" ? "photo" : "video";
      const c = cap();
      const r = await tg(method, { chat_id: chatId, [key]: m.url, caption: c, parse_mode: c ? pm : undefined });
      if (!r.ok) fail(r.description);
    } else if (visuals.length > 1) {
      const c = cap();
      const group = visuals.slice(0, 10).map((m, i) => ({
        type: m.type, media: m.url,
        caption: i === 0 && c ? c : undefined, parse_mode: i === 0 && c ? pm : undefined,
      }));
      const r = await tg("sendMediaGroup", { chat_id: chatId, media: group });
      if (!r.ok) fail(r.description);
    }

    // 2) Аудио/файлы/голосовые — по одному. Голосовое и видео без подписи.
    for (const m of singles) {
      if (m.type === "voice") {
        const r = await tg("sendVoice", { chat_id: chatId, voice: m.url });
        if (!r.ok) fail(r.description);
      } else if (m.type === "audio") {
        const c = cap();
        const r = await tg("sendAudio", { chat_id: chatId, audio: m.url, title: m.title, performer: m.performer, caption: c, parse_mode: c ? pm : undefined });
        if (!r.ok) fail(r.description);
      } else {
        const c = cap();
        const r = await tg("sendDocument", { chat_id: chatId, document: m.url, caption: c, parse_mode: c ? pm : undefined });
        if (!r.ok) fail(r.description);
      }
    }

    // 3) Если текст никуда не влез (например, только голосовое) — отдельным сообщением.
    if (text && !captionUsed) {
      const r = await tg("sendMessage", { chat_id: chatId, text, parse_mode: pm });
      if (!r.ok) fail(r.description);
    }

    return firstErr ? { ok: false, error: firstErr } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
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

    if (b.action === "send") {
      const p = (b.input ?? {}) as { chat_id?: string; text?: string; parse_mode?: string | null; media?: Media[]; disable_preview?: boolean };
      if (!p.chat_id || !(await owns(p.chat_id))) return json({ error: "канал не привязан" }, 400);
      if (!p.text && !(p.media && p.media.length)) return json({ error: "пустой пост" }, 400);
      const r = await sendPost(p.chat_id, p.text ?? "", p.parse_mode ?? null, p.media ?? [], !!p.disable_preview);
      return r.ok ? json({ ok: true }) : json({ error: r.error || "не удалось отправить" }, 400);
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
      const { data, error } = await db.from("scheduled_posts").select("*").eq("owner_id", uid).order("publish_at");
      if (error) return json({ error: error.message }, 500);
      return json({ posts: data ?? [] });
    }

    if (b.action === "scheduled_cancel") {
      if (!b.id) return json({ error: "нет id" }, 400);
      await db.from("scheduled_posts").delete().eq("owner_id", uid).eq("id", b.id);
      return json({ ok: true });
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
