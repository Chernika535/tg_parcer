// Чтение каналов по MTProto под подключённым аккаунтом — для каналов с
// выключенным превью (которые недоступны через t.me/s). Возвращает текст,
// флаг медиа и ссылку. Если аккаунт не подключён — noAccount:true.
import { TelegramClient } from "npm:telegram@2.22.2";
import { StringSession } from "npm:telegram@2.22.2/sessions";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const API_ID = 2040;
const API_HASH = "b18441a1ff607e10a989891a5462e627";
const LIMIT = 20;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, "content-type": "application/json" } });

function norm(input: string): string | null {
  let s = input.trim().toLowerCase();
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
    if (!row?.session) return json({ posts: [], unavailable: [], noAccount: true });

    const body = (await req.json()) as { channels?: string[] };
    const channels = [...new Set((body.channels ?? []).map(norm).filter(Boolean) as string[])];
    if (channels.length === 0) return json({ posts: [], unavailable: [] });

    const client = new TelegramClient(new StringSession(row.session), API_ID, API_HASH, {
      connectionRetries: 3,
      useWSS: true,
    });
    await client.connect();

    const posts: Record<string, unknown>[] = [];
    const unavailable: string[] = [];
    for (const ch of channels) {
      try {
        const entity = await client.getEntity(ch);
        const msgs = await client.getMessages(entity, { limit: LIMIT });
        if (!msgs.length) {
          unavailable.push(ch);
          continue;
        }
        for (const m of msgs) {
          const text = (m as { message?: string }).message ?? "";
          if (!text && !(m as { media?: unknown }).media) continue;
          const date = (m as { date: number }).date;
          posts.push({
            channel: ch,
            msgId: (m as { id: number }).id,
            postedAt: new Date(date * 1000).toISOString(),
            text,
            hasMedia: !!(m as { media?: unknown }).media,
            media: [],
            link: `https://t.me/${ch}/${(m as { id: number }).id}`,
          });
        }
      } catch (_e) {
        unavailable.push(ch);
      }
    }
    await client.disconnect();
    posts.sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)));
    return json({ posts, unavailable });
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
