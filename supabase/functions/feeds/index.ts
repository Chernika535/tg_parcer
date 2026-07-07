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
    if (req.method === "GET") {
      const sp = new URL(req.url).searchParams;
      action = sp.get("action") ?? undefined;
      id = sp.get("id") ? Number(sp.get("id")) : undefined;
    } else {
      const b = (await req.json().catch(() => ({}))) as { action?: string; id?: number };
      action = b.action;
      id = b.id;
    }
    const body = { action, id };

    if (body.action === "public") {
      const { data, error } = await db
        .from("feeds")
        .select("*")
        .eq("visibility", "public")
        .eq("status", "approved")
        .order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);
      const { data: pins } = await db.from("feed_pins").select("*");
      return json({ feeds: data ?? [], pins: pins ?? [] });
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
      return json({ feed: data });
    }

    // Превью ЛЮБОЙ ленты по ссылке (в т.ч. приватной) — только безопасная мета
    // для экрана «Добавить себе». Постов и владельца не отдаём.
    if (body.action === "preview") {
      if (!body.id) return json({ error: "нет id" }, 400);
      const { data, error } = await db
        .from("feeds")
        .select("id, title, description, channels, tags, author_name, cover_url, visibility")
        .eq("id", body.id)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ feed: data ?? null });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
