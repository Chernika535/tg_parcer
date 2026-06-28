// Публичное чтение лент через edge-функцию (а не REST). В России основной
// REST-домен Supabase часто заблокирован без VPN, а /functions/v1 — доступен.
// Поэтому список публичных лент и открытие ленты по id идут сюда.
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const body = (await req.json()) as { action?: string; id?: number };

    if (body.action === "public") {
      const { data, error } = await db
        .from("feeds")
        .select("*, owner:profiles(display_name, username)")
        .eq("visibility", "public")
        .eq("status", "approved")
        .order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ feeds: data ?? [] });
    }

    if (body.action === "get") {
      if (!body.id) return json({ error: "нет id" }, 400);
      const { data, error } = await db
        .from("feeds")
        .select("*, owner:profiles(display_name, username)")
        .eq("id", body.id)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      // Анонимно отдаём только публичные одобренные ленты (приватные — через REST под входом).
      if (!data || data.visibility !== "public" || data.status !== "approved") {
        return json({ feed: null });
      }
      return json({ feed: data });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
