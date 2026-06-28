// Чтение каналов по MTProto (GramJS) под подключённым аккаунтом — для каналов
// с выключенным превью. Сессия (StringSession) создаётся входом в браузере.
// GramJS грузится лениво (иначе 503 на старте). Транспорт — WebSocket (useWSS).
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

    const tg = await import("npm:telegram@2.26.22");
    const TelegramClient = tg.TelegramClient;
    const StringSession = tg.sessions.StringSession;
    const client = new TelegramClient(new StringSession(row.session), API_ID, API_HASH, {
      connectionRetries: 3,
      useWSS: true,
    });
    await client.connect();

    const posts: Record<string, unknown>[] = [];
    const unavailable: string[] = [];
    const errs: string[] = [];
    for (const ch of channels) {
      try {
        // Резолвим username явно — getEntity на свежей сессии часто не находит
        // ещё не виденного пира. resolveUsername гарантированно даёт peer.
        let entity: unknown;
        try {
          entity = await client.getEntity(ch);
        } catch {
          // deno-lint-ignore no-explicit-any
          const res = await client.invoke(
            // deno-lint-ignore no-explicit-any
            new (tg as any).Api.contacts.ResolveUsername({ username: ch }),
          );
          // deno-lint-ignore no-explicit-any
          entity = (res as any).chats?.[0] ?? (res as any).users?.[0];
          if (!entity) throw new Error("username не резолвится");
        }
        // deno-lint-ignore no-explicit-any
        const msgs = await client.getMessages(entity as any, { limit: LIMIT } as any);
        if (!msgs?.length) {
          unavailable.push(ch);
          errs.push(ch + ": нет сообщений (возможно нужно вступить в канал)");
          continue;
        }
        for (const m of msgs) {
          const mm = m as unknown as { id: number; message?: string; date?: number; media?: unknown };
          const text = mm.message ?? "";
          const hasMedia = !!mm.media;
          if (!text && !hasMedia) continue;
          posts.push({
            channel: ch,
            msgId: mm.id,
            postedAt: new Date((mm.date ?? 0) * 1000).toISOString(),
            text,
            hasMedia,
            media: [],
            link: `https://t.me/${ch}/${mm.id}`,
          });
        }
      } catch (e) {
        unavailable.push(ch);
        errs.push(ch + ": " + ((e as Error).message || String(e)));
      }
    }
    try {
      await client.disconnect();
    } catch {
      /* ignore */
    }
    posts.sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)));
    return json({ posts, unavailable, note: errs.length ? errs.join(" | ") : undefined });
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
