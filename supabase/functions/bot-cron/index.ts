// Планировщик отложенных постов. Вызывается по расписанию (pg_cron → pg_net, раз в
// минуту) или вручную. Берёт посты со статусом pending и publish_at<=now(), шлёт их
// через Bot API, помечает sent/failed. Работает под service-role (минуя RLS).
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { makeSender, type Media } from "../_shared/send.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors, "content-type": "application/json" } });

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const sendPost = makeSender(BOT_TOKEN, SUPABASE_URL);

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
      if (r.sent && r.sent.messageIds.length) {
        await db.from("posted_messages").insert({
          owner_id: p.owner_id, chat_id: p.chat_id, message_ids: r.sent.messageIds,
          text_message_id: r.sent.textMessageId ?? null, is_caption: r.sent.isCaption,
          text: p.text ?? null, parse_mode: p.parse_mode ?? null,
        });
      }
      if (r.ok) { await db.from("scheduled_posts").update({ status: "sent", sent_at: new Date().toISOString(), error: null }).eq("id", p.id); sent++; }
      else { await db.from("scheduled_posts").update({ status: "failed", error: r.error ?? "ошибка" }).eq("id", p.id); failed++; }
    }
    return json({ ok: true, sent, failed, checked: (due ?? []).length });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
