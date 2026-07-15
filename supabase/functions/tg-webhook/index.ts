// Вебхук Telegram: ловим НОВЫЕ посты, опубликованные напрямую в привязанных
// каналах (бот там админ), и складываем их в наш архив — чтобы канал жил у нас,
// даже если посты публиковались не через наш композер.
//
// V1 (безопасная, изолированная): сохраняем текст поста + самое крупное фото
// (Bot API отдаёт файлы до ~20 МБ). Форматирование, видео/аудио/документы и
// склейку альбомов добавим отдельно. Функция best-effort — ошибки не критичны.
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

function normCh(c: string): string {
  return (c || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^t\.me\//, "").replace(/^s\//, "").replace(/^@/, "")
    .split(/[/?#]/)[0].replace(/[^a-z0-9_]/g, "");
}

// deno-lint-ignore no-explicit-any
async function tg(method: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${API}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return await r.json();
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok");
  // Проверка секрета вебхука (Telegram шлёт его в заголовке).
  if (WEBHOOK_SECRET && req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    // deno-lint-ignore no-explicit-any
    const update = await req.json() as any;
    const msg = update.channel_post ?? update.edited_channel_post;
    if (!msg || !msg.chat || !SERVICE_ROLE) return new Response("ok");

    const chatId = String(msg.chat.id);
    const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    // Архивируем только привязанные каналы (бот там админ, автор их подключил).
    const { data: ch } = await svc.from("author_channels").select("owner_id, username").eq("chat_id", chatId).maybeSingle();
    if (!ch) return new Response("ok");

    const username = ch.username ? normCh(ch.username) : (msg.chat.username ? normCh(msg.chat.username) : null);
    const text: string = msg.text ?? msg.caption ?? "";

    // Самое крупное фото (если есть) — качаем через Bot API и кладём в наш Storage.
    const media: Record<string, unknown>[] = [];
    try {
      if (Array.isArray(msg.photo) && msg.photo.length) {
        const largest = msg.photo[msg.photo.length - 1];
        if (largest?.file_id && (largest.file_size ?? 0) < 15_000_000) {
          const f = await tg("getFile", { file_id: largest.file_id });
          const path = f?.result?.file_path;
          if (path) {
            const dl = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`);
            if (dl.ok) {
              const bytes = new Uint8Array(await dl.arrayBuffer());
              const key = `archive/${chatId.replace(/[^0-9]/g, "")}/${msg.message_id}.jpg`;
              const up = await svc.storage.from("covers").upload(key, bytes, { contentType: "image/jpeg", upsert: true });
              if (!up.error) {
                const pub = svc.storage.from("covers").getPublicUrl(key).data.publicUrl;
                media.push({ type: "photo", url: pub });
              }
            }
          }
        }
      }
    } catch { /* без фото — сохраним хотя бы текст */ }

    if (!text && media.length === 0) return new Response("ok");

    await svc.from("archived_posts").upsert({
      owner_id: ch.owner_id ?? null,
      chat_id: chatId,
      username,
      msg_id: msg.message_id,
      posted_at: new Date((msg.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      text: text || null,
      media,
      source: "live",
    }, { onConflict: "chat_id,msg_id" });

    return new Response("ok");
  } catch {
    return new Response("ok"); // вебхук всегда отвечает 200, чтобы Telegram не ретраил вечно
  }
});
