// Публичное чтение лент через edge-функцию (а не REST). В России основной
// REST-домен Supabase часто заблокирован без VPN, а /functions/v1 — доступен.
// Поэтому список публичных лент и открытие ленты по id идут сюда.
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    // Параметры берём из query (GET — проходит в РФ без VPN) или из тела (POST).
    let action: string | undefined;
    let id: number | undefined;
    let channel: string | undefined;
    if (req.method === "GET") {
      const sp = new URL(req.url).searchParams;
      action = sp.get("action") ?? undefined;
      id = sp.get("id") ? Number(sp.get("id")) : undefined;
      channel = sp.get("channel") ?? undefined;
    } else {
      const b = (await req.json().catch(() => ({}))) as { action?: string; id?: number };
      action = b.action;
      id = b.id;
    }
    const body = { action, id };

    // Нормализация ника канала и загрузка/фильтрация заблокированных.
    const norm = (c: string) => (c || "").trim().toLowerCase()
      .replace(/^https?:\/\//, "").replace(/^t\.me\//, "").replace(/^s\//, "").replace(/^@/, "")
      .split(/[/?#]/)[0].replace(/[^a-z0-9_]/g, "");
    async function blockedSet(): Promise<Set<string>> {
      const { data } = await db.from("blocked_channels").select("username");
      return new Set((data ?? []).map((r: { username: string }) => r.username));
    }
    // deno-lint-ignore no-explicit-any
    const stripBlocked = (feeds: any[], blocked: Set<string>) =>
      (feeds ?? []).map((f) => ({ ...f, channels: ((f.channels ?? []) as string[]).filter((c) => !blocked.has(norm(c))) }));

    // Соцссылки канала (TikTok) — публично, для страницы канала.
    if (body.action === "channel_links") {
      const un = norm(channel ?? "");
      if (!un) return json({ tiktok: null });
      const { data } = await db.from("author_channels").select("tiktok_url").ilike("username", un).limit(1).maybeSingle();
      return json({ tiktok: (data as { tiktok_url?: string } | null)?.tiktok_url ?? null });
    }

    // Архив канала: посты, сохранённые у нас (переживают недоступность Telegram).
    if (body.action === "archive") {
      const un = norm(channel ?? "");
      if (!un) return json({ posts: [] });
      const { data } = await db.from("archived_posts")
        .select("username, msg_id, posted_at, text, media")
        .eq("username", un).order("posted_at", { ascending: false }).limit(100);
      const posts = (data ?? []).map((r: Record<string, unknown>) => ({
        channel: un,
        msgId: Number(r.msg_id) || 0,
        postedAt: r.posted_at,
        text: r.text ?? "",
        hasMedia: Array.isArray(r.media) && (r.media as unknown[]).length > 0,
        media: r.media ?? [],
        link: `https://t.me/${un}/${r.msg_id}`,
        archived: true,
      }));
      return json({ posts });
    }

    if (body.action === "blocked") {
      const { data } = await db.from("blocked_channels").select("username, reason, created_at").order("created_at", { ascending: false });
      return json({ blocked: data ?? [] });
    }

    if (body.action === "public") {
      const { data, error } = await db
        .from("feeds")
        .select("*")
        .eq("visibility", "public")
        .eq("status", "approved")
        .order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);
      const { data: pins } = await db.from("feed_pins").select("*");
      return json({ feeds: stripBlocked(data ?? [], await blockedSet()), pins: pins ?? [] });
    }

    if (body.action === "get") {
      if (!body.id) return json({ error: "нет id" }, 400);
      const { data, error } = await db
        .from("feeds")
        .select("*")
        .eq("id", body.id)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      // Анонимно отдаём только публичные одобренные ленты (приватные — через REST под входом).
      if (!data || data.visibility !== "public" || data.status !== "approved") {
        return json({ feed: null });
      }
      return json({ feed: stripBlocked([data], await blockedSet())[0] });
    }

    // Превью ЛЮБОЙ ленты по ссылке (в т.ч. приватной) — только безопасная мета
    // для экрана «Добавить себе». Постов и владельца не отдаём.
    if (body.action === "preview") {
      if (!body.id) return json({ error: "нет id" }, 400);
      const { data, error } = await db
        .from("feeds")
        .select("id, title, description, channels, tags, author_name, cover_url, visibility, adult")
        .eq("id", body.id)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ feed: data ? stripBlocked([data], await blockedSet())[0] : null });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
