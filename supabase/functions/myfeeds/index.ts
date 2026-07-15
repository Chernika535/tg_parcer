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
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

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

    // ---- Заблокированные каналы (админ прячет их из всех подборок) ----
    const norm = (c: string) => (c || "").trim().toLowerCase()
      .replace(/^https?:\/\//, "").replace(/^t\.me\//, "").replace(/^s\//, "").replace(/^@/, "")
      .split(/[/?#]/)[0].replace(/[^a-z0-9_]/g, "");
    async function blockedSet(): Promise<Set<string>> {
      const { data } = await db.from("blocked_channels").select("username");
      return new Set((data ?? []).map((r: { username: string }) => r.username));
    }
    // deno-lint-ignore no-explicit-any
    const stripBlockedFeeds = (feeds: any[], blocked: Set<string>) =>
      (feeds ?? []).map((f) => f && ({ ...f, channels: ((f.channels ?? []) as string[]).filter((c) => !blocked.has(norm(c))) }));
    async function isAdmin(): Promise<boolean> {
      const { data } = await db.from("profiles").select("is_admin").eq("id", uid).maybeSingle();
      return !!(data as { is_admin?: boolean } | null)?.is_admin;
    }

    const b = (await req.json()) as {
      action: string;
      id?: number;
      input?: Record<string, unknown>;
      fields?: Record<string, unknown>;
      decision?: string;
      reason?: string;
      value?: boolean;
    };

    if (b.action === "update_profile") {
      const p = (b.input ?? {}) as { display_name?: string; photo_url?: string; birth_date?: string | null };
      const patch: Record<string, unknown> = { id: uid };
      if (p.display_name !== undefined) patch.display_name = p.display_name || null;
      if (p.photo_url !== undefined) patch.photo_url = p.photo_url || null;
      if (p.birth_date !== undefined) patch.birth_date = p.birth_date || null;
      const { data, error } = await db.from("profiles").upsert(patch).select("*").maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ profile: data });
    }

    // Привязка/смена e-mail и пароля — сразу, под service-role, БЕЗ письма-подтверждения.
    // Через client-side auth.updateUser почта уходит в «ожидание подтверждения», а
    // дефолтный SMTP Supabase до ya.ru/gmail часто не доходит — почта не применяется.
    if (b.action === "set_credentials") {
      if (!SERVICE_ROLE) return json({ error: "функция не сконфигурирована (service role)" }, 500);
      const p = (b.input ?? {}) as { email?: string; password?: string };
      const patch: { email?: string; password?: string; email_confirm?: boolean } = {};
      if (p.email && p.email.trim()) {
        const em = p.email.trim().toLowerCase();
        if (!isEmail(em)) return json({ error: "неверный формат e-mail" }, 400);
        patch.email = em;
        patch.email_confirm = true; // применяем сразу, без письма
      }
      if (p.password) {
        if (p.password.length < 6) return json({ error: "пароль не короче 6 символов" }, 400);
        patch.password = p.password;
      }
      if (!patch.email && !patch.password) return json({ error: "укажите e-mail и/или пароль" }, 400);
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
      const { data, error } = await admin.auth.admin.updateUserById(uid, patch);
      if (error) {
        const msg = /already been registered|already exists/i.test(error.message)
          ? "этот e-mail уже занят другим аккаунтом"
          : error.message;
        return json({ error: msg }, 400);
      }
      return json({ ok: true, email: data.user?.email });
    }

    if (b.action === "list_mine") {
      const { data, error } = await db.from("feeds").select("*").eq("owner_id", uid).order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ feeds: stripBlockedFeeds(data ?? [], await blockedSet()) });
    }

    if (b.action === "get_any") {
      if (!b.id) return json({ error: "нет id" }, 400);
      // RLS вернёт ленту, если она видна пользователю (своя / админ / одобренная).
      const { data } = await db
        .from("feeds")
        .select("*, owner:profiles!owner_id(display_name, username)")
        .eq("id", b.id)
        .maybeSingle();
      return json({ feed: data ? stripBlockedFeeds([data], await blockedSet())[0] : null });
    }

    if (b.action === "list_public_all") {
      // Все публичные ленты всех статусов — для админа (RLS отдаёт всё только ему).
      const { data, error } = await db
        .from("feeds")
        .select("*, owner:profiles!owner_id(display_name, username)")
        .eq("visibility", "public")
        .order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ feeds: data ?? [] });
    }

    if (b.action === "list_pending") {
      const { data, error } = await db
        .from("feeds")
        .select("*, owner:profiles!owner_id(display_name, username)")
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

    // Скопировать ЛЮБУЮ ленту (по ссылке) себе как приватную. Источник читаем
    // под service-role (чужую приватную RLS бы не отдала), создаём — под JWT.
    if (b.action === "clone") {
      if (!b.id) return json({ error: "нет id" }, 400);
      if (!SERVICE_ROLE) return json({ error: "функция не сконфигурирована (service role)" }, 500);
      const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
      const { data: src } = await svc.from("feeds").select("title, description, channels, tags, author_name, cover_url").eq("id", b.id).maybeSingle();
      if (!src) return json({ error: "лента не найдена" }, 404);
      const { data, error } = await db.from("feeds").insert({
        title: src.title,
        description: src.description ?? null,
        channels: src.channels ?? [],
        tags: src.tags ?? [],
        author_name: src.author_name ?? null,
        cover_url: src.cover_url ?? null,
        visibility: "private",
        owner_id: uid,
      }).select("*").single();
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

    // ---- Избранное ----
    if (b.action === "fav_links") {
      const { data } = await db.from("favorites").select("link").eq("user_id", uid);
      return json({ links: (data ?? []).map((r: { link: string }) => r.link) });
    }
    if (b.action === "fav_list") {
      const { data, error } = await db
        .from("favorites")
        .select("data, folder")
        .eq("user_id", uid)
        .order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);
      // Папку домешиваем в объект поста, чтобы клиент показал её без второго запроса.
      return json({
        posts: (data ?? []).map((r: { data: Record<string, unknown>; folder: string | null }) => ({
          ...(r.data as Record<string, unknown>),
          folder: r.folder ?? null,
        })),
      });
    }
    if (b.action === "fav_add") {
      const post = b.input as { link?: string; folder?: string | null } | undefined;
      if (!post?.link) return json({ error: "нет поста" }, 400);
      const row: Record<string, unknown> = { user_id: uid, link: post.link, data: post };
      if (post.folder !== undefined) row.folder = post.folder || null;
      const { error } = await db.from("favorites").upsert(row);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    if (b.action === "fav_set_folder") {
      const { link, folder } = (b.input ?? {}) as { link?: string; folder?: string | null };
      if (!link) return json({ error: "нет ссылки" }, 400);
      const { error } = await db.from("favorites")
        .update({ folder: folder || null }).eq("user_id", uid).eq("link", link);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    if (b.action === "fav_remove") {
      const link = (b.input as { link?: string } | undefined)?.link;
      if (!link) return json({ error: "нет ссылки" }, 400);
      const { error } = await db.from("favorites").delete().eq("user_id", uid).eq("link", link);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ---- Избранные ЛЕНТЫ ----
    if (b.action === "ffav_ids") {
      const { data } = await db.from("feed_favorites").select("feed_id").eq("user_id", uid);
      return json({ ids: (data ?? []).map((r: { feed_id: number }) => r.feed_id) });
    }
    if (b.action === "ffav_list") {
      const { data, error } = await db
        .from("feed_favorites")
        .select("feed:feeds(*, owner:profiles!owner_id(display_name, username))")
        .eq("user_id", uid)
        .order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);
      const feeds = (data ?? []).map((r: { feed: unknown }) => r.feed).filter(Boolean);
      return json({ feeds: stripBlockedFeeds(feeds, await blockedSet()) });
    }
    if (b.action === "ffav_add") {
      if (!b.id) return json({ error: "нет id" }, 400);
      const { error } = await db.from("feed_favorites").upsert({ user_id: uid, feed_id: b.id });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    if (b.action === "ffav_remove") {
      if (!b.id) return json({ error: "нет id" }, 400);
      const { error } = await db.from("feed_favorites").delete().eq("user_id", uid).eq("feed_id", b.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ---- Локальные лайки постов ----
    if (b.action === "like_links") {
      const { data } = await db.from("post_likes").select("link").eq("user_id", uid);
      return json({ links: (data ?? []).map((r: { link: string }) => r.link) });
    }
    if (b.action === "like_add") {
      const p = (b.input ?? {}) as { link?: string; channel?: string };
      if (!p.link || !p.channel) return json({ error: "нет данных" }, 400);
      const { error } = await db.from("post_likes").upsert({ user_id: uid, link: p.link, channel: p.channel });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    if (b.action === "like_remove") {
      const link = (b.input as { link?: string } | undefined)?.link;
      if (!link) return json({ error: "нет ссылки" }, 400);
      const { error } = await db.from("post_likes").delete().eq("user_id", uid).eq("link", link);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ---- Личные закрепления лент («Мои») ----
    if (b.action === "mypins_list") {
      const { data } = await db.from("feed_personal_pins").select("feed_id").eq("user_id", uid);
      return json({ ids: (data ?? []).map((r: { feed_id: number }) => r.feed_id) });
    }
    if (b.action === "mypin_add") {
      if (!b.id) return json({ error: "нет id" }, 400);
      const { error } = await db.from("feed_personal_pins").upsert({ user_id: uid, feed_id: b.id });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    if (b.action === "mypin_remove") {
      if (!b.id) return json({ error: "нет id" }, 400);
      const { error } = await db.from("feed_personal_pins").delete().eq("user_id", uid).eq("feed_id", b.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ---- Избранные ТЕГИ ----
    if (b.action === "tfav_list") {
      const { data } = await db.from("tag_favorites").select("tag").eq("user_id", uid).order("created_at", { ascending: false });
      return json({ tags: (data ?? []).map((r: { tag: string }) => r.tag) });
    }
    if (b.action === "tfav_add") {
      const tag = (b.input as { tag?: string } | undefined)?.tag?.trim().toLowerCase();
      if (!tag) return json({ error: "нет тега" }, 400);
      const { error } = await db.from("tag_favorites").upsert({ user_id: uid, tag });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    if (b.action === "tfav_remove") {
      const tag = (b.input as { tag?: string } | undefined)?.tag?.trim().toLowerCase();
      if (!tag) return json({ error: "нет тега" }, 400);
      const { error } = await db.from("tag_favorites").delete().eq("user_id", uid).eq("tag", tag);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ---- Закрепления (админ; RLS на feed_pins это гарантирует) ----
    if (b.action === "pins_list") {
      const { data, error } = await db.from("feed_pins").select("*").order("rank", { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ pins: data ?? [] });
    }
    if (b.action === "pin_set") {
      const i = (b.input ?? {}) as { feed_id?: number; tag?: string; rank?: number };
      if (!i.feed_id) return json({ error: "нет feed_id" }, 400);
      const { error } = await db
        .from("feed_pins")
        .upsert({ feed_id: i.feed_id, tag: i.tag ?? "", rank: i.rank ?? 0 }, { onConflict: "feed_id,tag" });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    if (b.action === "pin_remove") {
      const i = (b.input ?? {}) as { feed_id?: number; tag?: string };
      if (!i.feed_id) return json({ error: "нет feed_id" }, 400);
      const { error } = await db.from("feed_pins").delete().eq("feed_id", i.feed_id).eq("tag", i.tag ?? "");
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ---- Импорт истории канала из экспорта Telegram (владелец канала) ----
    if (b.action === "import_archive") {
      const inp = (b.input ?? {}) as { chat_id?: string; posts?: Record<string, unknown>[] };
      if (!inp.chat_id) return json({ error: "нет канала" }, 400);
      if (!SERVICE_ROLE) return json({ error: "функция не сконфигурирована (service role)" }, 500);
      // Владелец канала? (бот там админ, автор его подключил)
      const { data: ch } = await db.from("author_channels").select("username").eq("owner_id", uid).eq("chat_id", inp.chat_id).maybeSingle();
      if (!ch) return json({ error: "канал не привязан к вам" }, 403);
      const username = ch.username ? norm(ch.username) : null;
      const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
      const rows = (inp.posts ?? [])
        .filter((p) => p && p.msgId != null)
        .map((p) => ({
          owner_id: uid, chat_id: inp.chat_id, username,
          msg_id: Number(p.msgId), posted_at: (p.postedAt as string) || new Date().toISOString(),
          text: (p.text as string) || null, media: (p.media as unknown[]) ?? [], source: "import",
        }));
      if (rows.length === 0) return json({ ok: true, count: 0 });
      const { error } = await svc.from("archived_posts").upsert(rows, { onConflict: "chat_id,msg_id" });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, count: rows.length });
    }

    // ---- Блокировка каналов (только админ; пишем под service role) ----
    if (b.action === "blocked_list") {
      const { data } = await db.from("blocked_channels")
        .select("username, reason, created_at").order("created_at", { ascending: false });
      return json({ blocked: data ?? [] });
    }
    if (b.action === "block_channel" || b.action === "unblock_channel") {
      if (!(await isAdmin())) return json({ error: "только для админа" }, 403);
      if (!SERVICE_ROLE) return json({ error: "функция не сконфигурирована (service role)" }, 500);
      const un = norm((b.input as { username?: string } | undefined)?.username ?? "");
      if (!un) return json({ error: "нет канала" }, 400);
      const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
      if (b.action === "block_channel") {
        const reason = (b.input as { reason?: string } | undefined)?.reason ?? null;
        const { error } = await svc.from("blocked_channels")
          .upsert({ username: un, reason, blocked_by: uid }, { onConflict: "username" });
        if (error) return json({ error: error.message }, 500);
      } else {
        const { error } = await svc.from("blocked_channels").delete().eq("username", un);
        if (error) return json({ error: error.message }, 500);
      }
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
