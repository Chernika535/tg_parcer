// Планировщик отложенных постов. Вызывается по расписанию (pg_cron → pg_net, раз в
// минуту) или вручную. Берёт посты со статусом pending и publish_at<=now(), шлёт их
// через Bot API, помечает sent/failed. Работает под service-role (минуя RLS).
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors, "content-type": "application/json" } });

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tg(method: string, body: Record<string, unknown>) {
  const r = await fetch(`${API}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return await r.json() as { ok: boolean; description?: string };
}

type Media = { type: "photo" | "video" | "voice" | "audio" | "document"; url: string; name?: string; title?: string; performer?: string };

async function sendPost(chatId: string, text: string, pm: string | null, media: Media[], disablePreview: boolean): Promise<{ ok: boolean; error?: string }> {
  const parse = pm || undefined;
  if (!media.length) {
    const r = await tg("sendMessage", { chat_id: chatId, text: text || " ", parse_mode: parse, link_preview_options: disablePreview ? { is_disabled: true } : undefined });
    return r.ok ? { ok: true } : { ok: false, error: r.description };
  }
  const visuals = media.filter((m) => m.type === "photo" || m.type === "video");
  const singles = media.filter((m) => m.type === "voice" || m.type === "audio" || m.type === "document");
  let used = false;
  const cap = () => (!used && text ? ((used = true), text) : undefined);
  let firstErr = "";
  const fail = (d?: string) => { if (!firstErr && d) firstErr = d; };

  if (visuals.length === 1) {
    const m = visuals[0];
    const method = m.type === "photo" ? "sendPhoto" : "sendVideo";
    const key = m.type === "photo" ? "photo" : "video";
    const c = cap();
    const r = await tg(method, { chat_id: chatId, [key]: m.url, caption: c, parse_mode: c ? parse : undefined });
    if (!r.ok) fail(r.description);
  } else if (visuals.length > 1) {
    const c = cap();
    const group = visuals.slice(0, 10).map((m, i) => ({ type: m.type, media: m.url, caption: i === 0 && c ? c : undefined, parse_mode: i === 0 && c ? parse : undefined }));
    const r = await tg("sendMediaGroup", { chat_id: chatId, media: group });
    if (!r.ok) fail(r.description);
  }
  for (const m of singles) {
    if (m.type === "voice") { const r = await tg("sendVoice", { chat_id: chatId, voice: m.url }); if (!r.ok) fail(r.description); }
    else if (m.type === "audio") { const c = cap(); const r = await tg("sendAudio", { chat_id: chatId, audio: m.url, title: m.title, performer: m.performer, caption: c, parse_mode: c ? parse : undefined }); if (!r.ok) fail(r.description); }
    else { const c = cap(); const r = await tg("sendDocument", { chat_id: chatId, document: m.url, caption: c, parse_mode: c ? parse : undefined }); if (!r.ok) fail(r.description); }
  }
  if (text && !used) { const r = await tg("sendMessage", { chat_id: chatId, text, parse_mode: parse }); if (!r.ok) fail(r.description); }
  return firstErr ? { ok: false, error: firstErr } : { ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!BOT_TOKEN) return json({ error: "нет TELEGRAM_BOT_TOKEN" }, 500);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: due } = await db
      .from("scheduled_posts")
      .select("*")
      .eq("status", "pending")
      .lte("publish_at", new Date().toISOString())
      .order("publish_at")
      .limit(20);
    let sent = 0, failed = 0;
    for (const p of due ?? []) {
      const r = await sendPost(p.chat_id, p.text ?? "", p.parse_mode ?? null, (p.media ?? []) as Media[], !!p.disable_preview);
      if (r.ok) { await db.from("scheduled_posts").update({ status: "sent", sent_at: new Date().toISOString(), error: null }).eq("id", p.id); sent++; }
      else { await db.from("scheduled_posts").update({ status: "failed", error: r.error ?? "ошибка" }).eq("id", p.id); failed++; }
    }
    return json({ ok: true, sent, failed, checked: (due ?? []).length });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
