// Операции с лентами от имени пользователя (по его JWT). Нужно, потому что
// прямой supabase-js REST через прокси Onreza ненадёжен (RLS-апдейты «молча»
// затрагивают 0 строк). Здесь создаём клиент с JWT пользователя — RLS и триггеры
// (бейджи, статус, is_admin) работают правильно, а сам запрос к БД идёт внутри
// инфраструктуры Supabase (стабильно).
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, "content-type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!jwt) return json({ error: "нужен вход" }, 401);
    // Клиент «от имени пользователя» — RLS видит auth.uid(), триггеры работают.
    const db = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false },
    });
    const { data: u } = await db.auth.getUser();
    if (!u.user) return json({ error: "нужен вход" }, 401);
    const uid = u.user.id;

    const b = (await req.json()) as {
      action: string;
      id?: number;
      input?: Record<string, unknown>;
      fields?: Record<string, unknown>;
      decision?: string;
      reason?: string;
      value?: boolean;
    };

    if (b.action === "list_mine") {
      const { data, error } = await db.from("feeds").select("*").eq("owner_id", uid).order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ feeds: data ?? [] });
    }

    if (b.action === "list_pending") {
      const { data, error } = await db
        .from("feeds")
        .select("*, owner:profiles(display_name, username)")
        .eq("visibility", "public")
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (error) return json({ error: error.message }, 500);
      return json({ feeds: data ?? [] });
    }

    if (b.action === "create") {
      const i = b.input ?? {};
      const { data, error } = await db
        .from("feeds")
        .insert({ ...i, owner_id: uid })
        .select("*")
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ feed: data });
    }

    if (b.action === "update") {
      if (!b.id) return json({ error: "нет id" }, 400);
      const { data, error } = await db.from("feeds").update(b.fields ?? {}).eq("id", b.id).select("*");
      if (error) return json({ error: error.message }, 500);
      if (!data || data.length === 0) return json({ error: "лента не обновлена (нет прав или не найдена)" }, 403);
      return json({ feed: data[0] });
    }

    if (b.action === "delete") {
      if (!b.id) return json({ error: "нет id" }, 400);
      const { error } = await db.from("feeds").delete().eq("id", b.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (b.action === "moderate") {
      if (!b.id) return json({ error: "нет id" }, 400);
      const { error } = await db
        .from("feeds")
        .update({ status: b.decision, reject_reason: b.reason ?? null })
        .eq("id", b.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (b.action === "set_official") {
      if (!b.id) return json({ error: "нет id" }, 400);
      const { error } = await db.from("feeds").update({ official: !!b.value }).eq("id", b.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
