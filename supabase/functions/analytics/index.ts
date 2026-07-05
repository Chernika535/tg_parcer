// Аналитика для администратора.
//  - action "track": публичная запись обезличенного события просмотра
//    (сайт / лента / канал / пост). Пишем через service role.
//  - action "stats": сводка и рейтинги за период — ТОЛЬКО для админа.
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
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const KINDS = new Set(["site", "feed", "channel", "post"]);

function svcClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
}

// Считаем строки таблицы в диапазоне [fromISO, toISO] (любая граница необязательна).
async function countRange(svc: ReturnType<typeof svcClient>, table: string, col: string, fromISO: string | null, toISO: string | null) {
  let q = svc.from(table).select("*", { count: "exact", head: true });
  if (fromISO) q = q.gte(col, fromISO);
  if (toISO) q = q.lte(col, toISO);
  const { count } = await q;
  return count ?? 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = (await req.json()) as {
      action?: string; kind?: string; target?: string; session?: string;
      days?: number; from?: string; to?: string;
    };

    // ---- Запись события (публично, но только валидные виды) ----
    if (b.action === "track") {
      if (!SERVICE_ROLE) return json({ ok: false });
      const kind = String(b.kind ?? "");
      if (!KINDS.has(kind)) return json({ ok: false });
      const target = b.target ? String(b.target).slice(0, 300) : null;
      const session = b.session ? String(b.session).slice(0, 64) : null;
      // uid — если пришёл валидный JWT (необязательно).
      let uid: string | null = null;
      const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
      if (jwt) {
        try {
          const u = createClient(SUPABASE_URL, ANON, {
            global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false },
          });
          const { data } = await u.auth.getUser();
          uid = data.user?.id ?? null;
        } catch { /* аноним */ }
      }
      const svc = svcClient();
      await svc.from("analytics_events").insert({ kind, target, session, uid });
      return json({ ok: true });
    }

    // ---- Сводка для админа ----
    if (b.action === "stats") {
      const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
      if (!jwt) return json({ error: "нужен вход" }, 401);
      const db = createClient(SUPABASE_URL, ANON, {
        global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false },
      });
      const { data: u } = await db.auth.getUser();
      if (!u.user) return json({ error: "нужен вход" }, 401);
      const { data: prof } = await db.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
      if (prof?.role !== "admin") return json({ error: "только для админа" }, 403);
      if (!SERVICE_ROLE) return json({ error: "функция не сконфигурирована (service role)" }, 500);
      const svc = svcClient();

      // Период: либо кастомный диапазон from/to, либо последние `days` суток
      // (days = 0 → всё время). from/to имеют приоритет.
      const days = Number(b.days ?? 30);
      const parseISO = (v?: string) => { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); };
      const customFrom = parseISO(b.from);
      const customTo = parseISO(b.to);
      const fromISO = customFrom ?? (days > 0 ? new Date(Date.now() - days * 86400_000).toISOString() : null);
      const toISO = customTo;

      // События просмотров за период (виды + цель + сессия).
      let ev = svc.from("analytics_events").select("kind, target, session").limit(200000);
      if (fromISO) ev = ev.gte("ts", fromISO);
      if (toISO) ev = ev.lte("ts", toISO);
      const { data: events } = await ev;

      type Agg = { views: number; sessions: Set<string> };
      const perKind: Record<string, Agg> = {
        site: { views: 0, sessions: new Set() },
        feed: { views: 0, sessions: new Set() },
        channel: { views: 0, sessions: new Set() },
        post: { views: 0, sessions: new Set() },
      };
      const top: Record<string, Map<string, Agg>> = { feed: new Map(), channel: new Map(), post: new Map() };
      for (const e of (events ?? []) as { kind: string; target: string | null; session: string | null }[]) {
        const k = perKind[e.kind];
        if (!k) continue;
        k.views++; if (e.session) k.sessions.add(e.session);
        if (top[e.kind] && e.target) {
          const m = top[e.kind];
          const a = m.get(e.target) ?? { views: 0, sessions: new Set() };
          a.views++; if (e.session) a.sessions.add(e.session);
          m.set(e.target, a);
        }
      }
      // Отдаём весь рейтинг (до 500 строк) — админу важны и середина, и низ.
      const rank = (m: Map<string, Agg>) =>
        [...m.entries()]
          .map(([target, a]) => ({ target, views: a.views, uniques: a.sessions.size }))
          .sort((x, y) => y.views - x.views || y.uniques - x.uniques)
          .slice(0, 500);

      // Обогащаем топ лент названиями, топ каналов — как есть (ник).
      const feedTop = rank(top.feed);
      const ids = feedTop.map((f) => Number(f.target)).filter((n) => Number.isFinite(n));
      const titles: Record<string, string> = {};
      if (ids.length) {
        const { data: fr } = await svc.from("feeds").select("id, title").in("id", ids);
        for (const f of (fr ?? []) as { id: number; title: string }[]) titles[String(f.id)] = f.title;
      }
      const feedTopNamed = feedTop.map((f) => ({ ...f, title: titles[f.target] ?? `#${f.target}` }));

      // Новые регистрации / авторы / каналы / посты / избранное / лайки за период.
      const newUsers = await countRange(svc, "profiles", "created_at", fromISO, toISO);
      const newChannels = await countRange(svc, "author_channels", "created_at", fromISO, toISO);
      const postsPublished = await countRange(svc, "posted_messages", "sent_at", fromISO, toISO);
      const newFavorites = await countRange(svc, "favorites", "created_at", fromISO, toISO);
      const newLikes = await countRange(svc, "post_likes", "created_at", fromISO, toISO);

      // Новые авторы = уникальные владельцы, привязавшие канал за период.
      let acQ = svc.from("author_channels").select("owner_id").limit(100000);
      if (fromISO) acQ = acQ.gte("created_at", fromISO);
      if (toISO) acQ = acQ.lte("created_at", toISO);
      const { data: ac } = await acQ;
      const newAuthors = new Set((ac ?? []).map((r: { owner_id: string }) => r.owner_id)).size;

      // Всего в базе (без периода) — для контекста.
      const totalUsers = await countRange(svc, "profiles", "created_at", null, null);
      const totalChannels = await countRange(svc, "author_channels", "created_at", null, null);

      return json({
        stats: {
          days,
          visitors: { views: perKind.site.views, uniques: perKind.site.sessions.size },
          feedViews: { views: perKind.feed.views, uniques: perKind.feed.sessions.size },
          channelViews: { views: perKind.channel.views, uniques: perKind.channel.sessions.size },
          postViews: { views: perKind.post.views, uniques: perKind.post.sessions.size },
          newUsers, newAuthors, newChannels, postsPublished, newFavorites, newLikes,
          totalUsers, totalChannels,
          topFeeds: feedTopNamed,
          topChannels: rank(top.channel),
          topPosts: rank(top.post),
        },
      });
    }

    return json({ error: "неизвестное действие" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
