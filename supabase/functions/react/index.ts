// Ставит реакцию (по умолчанию ❤) на пост канала под подключённым аккаунтом —
// «лайк из ленты улетает в Telegram-канал». Требует подключённого аккаунта.
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const API_ID = 2040;
const API_HASH = "b18441a1ff607e10a989891a5462e627";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, "content-type": "application/json" } });

function norm(input: string): string | null {
  let s = (input || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^t\.me\//, "").replace(/^s\//, "").replace(/^@/, "");
  s = s.split(/[/?#]/)[0].replace(/[^a-z0-9_]/g, "");
  return s.length >= 3 && s.length <= 64 ? s : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const { data: row } = await db.from("tg_session").select("session").eq("id", "default").maybeSingle();
    if (!row?.session) return json({ ok: false, noAccount: true });

    const body = (await req.json()) as { channel?: string; msgId?: number; emoji?: string; remove?: boolean };
    const channel = norm(body.channel || "");
    const msgId = Number(body.msgId);
    if (!channel || !Number.isFinite(msgId)) return json({ error: "нужны channel и msgId" }, 400);
    const emoji = body.emoji || "❤";

    const { TelegramClient, Api } = await import("npm:telegram@2.26.22");
    const { StringSession } = await import("npm:telegram@2.26.22/sessions");
    const client = new TelegramClient(new StringSession(row.session), API_ID, API_HASH, {
      connectionRetries: 3,
      useWSS: true,
    });
    await client.connect();
    try {
      const entity = await client.getEntity(channel);
      await client.invoke(
        new Api.messages.SendReaction({
          peer: entity,
          msgId,
          reaction: body.remove ? [] : [new Api.ReactionEmoji({ emoticon: emoji })],
        }),
      );
      return json({ ok: true });
    } finally {
      try {
        await client.disconnect();
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
