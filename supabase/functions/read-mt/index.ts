// Чтение каналов по MTProto (MTKruto) под подключённым аккаунтом — для каналов
// с выключенным превью. MTKruto грузится ЛЕНИВО (иначе 503 на старте).
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

    // ленивый импорт MTKruto
    const { Client, StorageMemory } = await import("https://deno.land/x/mtkruto/mod.ts");
    const client = new Client({ storage: new StorageMemory(), apiId: API_ID, apiHash: API_HASH });
    await client.importAuthString(row.session);
    await client.connect();

    const posts: Record<string, unknown>[] = [];
    const unavailable: string[] = [];
    for (const ch of channels) {
      try {
        const msgs = await client.getHistory("@" + ch, { limit: LIMIT });
        if (!msgs?.length) {
          unavailable.push(ch);
          continue;
        }
        for (const m of msgs) {
          const mm = m as unknown as {
            id: number; text?: string; caption?: string; date?: Date;
            photo?: unknown; video?: unknown; document?: unknown;
          };
          const text = mm.text ?? mm.caption ?? "";
          const hasMedia = !!(mm.photo || mm.video || mm.document);
          if (!text && !hasMedia) continue;
          posts.push({
            channel: ch,
            msgId: mm.id,
            postedAt: (mm.date ? new Date(mm.date) : new Date()).toISOString(),
            text,
            hasMedia,
            media: [],
            link: `https://t.me/${ch}/${mm.id}`,
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
