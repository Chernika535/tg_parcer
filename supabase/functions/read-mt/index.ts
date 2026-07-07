// Серверное чтение каналов без превью по MTProto (GramJS) под общим аккаунтом.
// Главный смысл — РОССИЯ: Telegram там доступен только через VPN, а это чтение
// идёт с сервера Supabase, поэтому пользователю VPN не нужен. Если GramJS на
// edge не заведётся — клиент откатится на чтение в браузере (там нужен VPN).
// Медиа отдаём как data-URL (base64): у MTProto нет готовых ссылок. Чтобы не
// раздуть ответ, качаем фото и аватар (с лимитом байт), видео — только превью.
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const API_ID = 2040;
const API_HASH = "b18441a1ff607e10a989891a5462e627";
const LIMIT = 12;
const BYTE_BUDGET = 4 * 1024 * 1024; // суммарный потолок на медиа в ответе
const DEADLINE_MS = 18000; // бюджет на ЧТЕНИЕ (после подключения)

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, "content-type": "application/json" } });

// Убираем «хвост» из реакций Telegram (эмодзи+число). Линейная проверка без
// вложенных кванторов (иначе ReDoS на длинных эмодзи-строках).
const REACT_ONLY = /^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\d\s,]+$/u;
function isReactionLine(line: string): boolean {
  const t = line.trim();
  if (t === "") return true;
  if (!/\d/.test(t)) return false;
  return REACT_ONLY.test(t);
}
function stripReactions(text: string): string {
  const lines = (text ?? "").split("\n");
  while (lines.length && isReactionLine(lines[lines.length - 1])) lines.pop();
  return lines.join("\n").trimEnd();
}

// Экранируем текст как HTML (защита от инъекций — фронт рендерит через innerHTML).
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// MTProto-сущности форматирования → безопасный HTML (b/i/u/s/code/blockquote/
// spoiler/ссылки). Смещения Telegram считаются в кодовых единицах UTF-16 = как в JS.
// deno-lint-ignore no-explicit-any
function entitiesToHtml(text: string, entities: any[]): string {
  if (!text) return "";
  if (!entities?.length) return esc(text);
  type Ins = { pos: number; open: boolean; order: number; html: string };
  const ins: Ins[] = [];
  let n = 0;
  for (const e of entities) {
    const start = e.offset ?? 0;
    const end = start + (e.length ?? 0);
    let o = "", c = "";
    switch (e.className) {
      case "MessageEntityBold": o = "<b>"; c = "</b>"; break;
      case "MessageEntityItalic": o = "<i>"; c = "</i>"; break;
      case "MessageEntityUnderline": o = "<u>"; c = "</u>"; break;
      case "MessageEntityStrike": o = "<s>"; c = "</s>"; break;
      case "MessageEntityCode": o = "<code>"; c = "</code>"; break;
      case "MessageEntityPre": o = "<code>"; c = "</code>"; break;
      case "MessageEntityBlockquote": o = "<blockquote>"; c = "</blockquote>"; break;
      case "MessageEntitySpoiler": o = '<span class="tg-spoiler">'; c = "</span>"; break;
      case "MessageEntityTextUrl":
        o = `<a href="${esc(String(e.url ?? "")).replace(/"/g, "%22")}" target="_blank" rel="noreferrer">`; c = "</a>"; break;
      case "MessageEntityUrl": {
        const u = text.slice(start, end);
        o = `<a href="${esc(u).replace(/"/g, "%22")}" target="_blank" rel="noreferrer">`; c = "</a>"; break;
      }
      default: continue;
    }
    ins.push({ pos: start, open: true, order: n, html: o });
    ins.push({ pos: end, open: false, order: n, html: c });
    n++;
  }
  // На одной позиции: сначала закрытия (позже открытые — раньше закрываются),
  // затем открытия (в порядке появления) — корректная вложенность.
  ins.sort((a, b) =>
    a.pos - b.pos
    || (a.open === b.open ? (a.open ? a.order - b.order : b.order - a.order) : (a.open ? 1 : -1)));
  let out = "", prev = 0;
  for (const t of ins) {
    if (t.pos > prev) out += esc(text.slice(prev, t.pos));
    out += t.html;
    prev = t.pos;
  }
  out += esc(text.slice(prev));
  // Если жирным набран весь пост (стиль автора) — снимаем жирность.
  const visible = (t: string) => t.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
  const total = visible(out);
  if (total) {
    let bold = 0;
    out.replace(/<b>([\s\S]*?)<\/b>/gi, (_m, x) => { bold += visible(x); return _m; });
    if (bold / total > 0.9) out = out.replace(/<\/?b>/gi, "");
  }
  return out;
}

function norm(input: string): string | null {
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^t\.me\//, "").replace(/^s\//, "").replace(/^@/, "");
  s = s.split(/[/?#]/)[0].replace(/[^a-z0-9_]/g, "");
  return s.length >= 3 && s.length <= 64 ? s : null;
}

type Media =
  | { type: "photo"; url: string }
  | { type: "video"; thumb?: string }
  | { type: "roundvideo"; thumb?: string }
  | { type: "voice"; url?: string }
  | { type: "audio"; url?: string; title?: string; performer?: string }
  | { type: "document"; title: string; extra?: string }
  | { type: "link"; href?: string; site?: string; title?: string; description?: string; image?: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const { data: row } = await db.from("tg_session").select("session").eq("id", "default").maybeSingle();
    if (!row?.session) return json({ posts: [], unavailable: [], noAccount: true });

    const body = (await req.json()) as { channels?: string[]; one?: { channel?: string; msgId?: number }; pinned?: { channel?: string }; meta?: { channel?: string } };

    // Режим «мета канала» (название/аватар) — для карточки канала в редакторе
    // ленты, когда публичного превью t.me/s недостаточно.
    if (body.meta?.channel) {
      const ch = norm(body.meta.channel);
      if (!ch) return json({ info: null });
      const tg = await import("npm:telegram@2.26.22");
      const client = new tg.TelegramClient(new tg.sessions.StringSession(row.session), API_ID, API_HASH, { connectionRetries: 2, useWSS: true });
      await withTimeout(client.connect(), 9000);
      try {
        // deno-lint-ignore no-explicit-any
        let entity: any;
        try { entity = await withTimeout(client.getEntity(ch), 8000); }
        catch {
          // deno-lint-ignore no-explicit-any
          const res: any = await withTimeout(client.invoke(new (tg as any).Api.contacts.ResolveUsername({ username: ch })), 8000);
          entity = res.chats?.[0] ?? res.users?.[0];
        }
        if (!entity) { try { await client.disconnect(); } catch { /* ignore */ } return json({ info: null }); }
        let avatar: string | undefined;
        try { avatar = dataUrl(await withTimeout(client.downloadProfilePhoto(entity), 6000), "image/jpeg"); } catch { /* без аватара */ }
        try { await client.disconnect(); } catch { /* ignore */ }
        return json({ info: { username: entity.username || ch, title: entity.title || entity.username || ch, avatar } });
      } catch (e) {
        try { await client.disconnect(); } catch { /* ignore */ }
        return json({ info: null, error: (e as Error).message || String(e) });
      }
    }

    // Режим «закреплённый пост канала» — для страницы канала.
    if (body.pinned?.channel) {
      const ch = norm(body.pinned.channel);
      if (!ch) return json({ error: "bad channel" });
      const tg = await import("npm:telegram@2.26.22");
      const client = new tg.TelegramClient(new tg.sessions.StringSession(row.session), API_ID, API_HASH, { connectionRetries: 2, useWSS: true });
      await withTimeout(client.connect(), 9000);
      try {
        // deno-lint-ignore no-explicit-any
        let entity: any;
        try { entity = await withTimeout(client.getEntity(ch), 8000); }
        catch {
          // deno-lint-ignore no-explicit-any
          const res: any = await withTimeout(client.invoke(new (tg as any).Api.contacts.ResolveUsername({ username: ch })), 8000);
          entity = res.chats?.[0] ?? res.users?.[0];
        }
        // deno-lint-ignore no-explicit-any
        const msgs: any[] = await withTimeout(
          // deno-lint-ignore no-explicit-any
          client.getMessages(entity, { limit: 1, filter: new (tg as any).Api.InputMessagesFilterPinned({}) } as any), 9000,
        );
        const m = msgs?.[0];
        if (!m) { try { await client.disconnect(); } catch { /* ignore */ } return json({ post: null }); }
        let img: string | undefined;
        try {
          if (m.photo) {
            const buf = await withTimeout(client.downloadMedia(m, {}), 6000) as Uint8Array;
            if (buf?.length && buf.length < 3 * 1024 * 1024) img = `data:image/jpeg;base64,${encodeBase64(buf)}`;
          }
        } catch { /* без картинки */ }
        try { await client.disconnect(); } catch { /* ignore */ }
        return json({
          post: {
            channel: ch, msgId: m.id, postedAt: new Date((m.date ?? 0) * 1000).toISOString(),
            text: stripReactions(entitiesToHtml(m.message ?? "", m.entities ?? [])), media: img ? [{ type: "photo", url: img }] : [],
            hasMedia: !!img, link: `https://t.me/${ch}/${m.id}`,
          },
        });
      } catch (e) {
        try { await client.disconnect(); } catch { /* ignore */ }
        return json({ post: null, error: (e as Error).message || String(e) });
      }
    }

    // Режим догрузки одного медиа (видео/голосовое) по channel+msgId — для крупных
    // видео открытых каналов, которых нет в t.me/s превью.
    if (body.one?.channel && body.one?.msgId) {
      const ch = norm(body.one.channel);
      if (!ch) return json({ error: "bad channel" });
      const tg = await import("npm:telegram@2.26.22");
      const client = new tg.TelegramClient(new tg.sessions.StringSession(row.session), API_ID, API_HASH, { connectionRetries: 2, useWSS: true });
      await withTimeout(client.connect(), 9000);
      const VIDEO_MAX = 25 * 1024 * 1024;
      try {
        // deno-lint-ignore no-explicit-any
        let entity: any;
        try { entity = await withTimeout(client.getEntity(ch), 8000); }
        catch {
          // deno-lint-ignore no-explicit-any
          const res: any = await withTimeout(client.invoke(new (tg as any).Api.contacts.ResolveUsername({ username: ch })), 8000);
          entity = res.chats?.[0] ?? res.users?.[0];
        }
        // deno-lint-ignore no-explicit-any
        const msgs: any[] = await withTimeout(client.getMessages(entity, { ids: [body.one.msgId] } as any), 9000);
        const m = msgs?.[0];
        const doc = m?.video || m?.gif || m?.videoNote || m?.document || m?.voice || m?.audio;
        const size = doc ? Number(doc.size ?? 0) : 0;
        if (!doc) return json({ error: "нет медиа" });
        if (size > VIDEO_MAX) return json({ tooBig: true });
        const buf = await withTimeout(client.downloadMedia(m, {}), 40000) as Uint8Array;
        try { await client.disconnect(); } catch { /* ignore */ }
        if (!buf?.length) return json({ error: "не удалось скачать" });
        const mime = doc.mimeType || (m.voice || m.audio ? "audio/ogg" : "video/mp4");
        return json({ url: `data:${mime};base64,${encodeBase64(buf)}` });
      } catch (e) {
        try { await client.disconnect(); } catch { /* ignore */ }
        return json({ error: (e as Error).message || String(e) });
      }
    }

    const channels = [...new Set((body.channels ?? []).map(norm).filter(Boolean) as string[])];
    if (channels.length === 0) return json({ posts: [], unavailable: [] });

    const tg = await import("npm:telegram@2.26.22");
    const TelegramClient = tg.TelegramClient;
    const StringSession = tg.sessions.StringSession;
    const client = new TelegramClient(new StringSession(row.session), API_ID, API_HASH, {
      connectionRetries: 2,
      useWSS: true,
    });
    await withTimeout(client.connect(), 9000);

    // Бюджет времени начинаем считать ПОСЛЕ подключения (импорт+connect не в счёт).
    const start = Date.now();
    const timeLeft = () => DEADLINE_MS - (Date.now() - start);

    let budget = BYTE_BUDGET;
    const dataUrl = (buf: unknown, mime: string): string | undefined => {
      const bytes = buf as Uint8Array | undefined;
      if (!bytes || bytes.length === 0 || bytes.length > budget) return undefined;
      budget -= bytes.length;
      return `data:${mime};base64,${encodeBase64(bytes)}`;
    };
    // deno-lint-ignore no-explicit-any
    const dl = async (target: any, opts?: Record<string, unknown>): Promise<unknown> => {
      if (timeLeft() < 2500) return undefined; // время вышло — отдаём текст без медиа
      try {
        return await withTimeout(client.downloadMedia(target, opts ?? {}), 6000);
      } catch {
        return undefined;
      }
    };
    const numOf = (v: unknown): number => {
      try {
        return typeof v === "bigint" ? Number(v) : Number(v ?? 0);
      } catch {
        return 0;
      }
    };

    // deno-lint-ignore no-explicit-any
    const extract = async (m: any): Promise<Media[]> => {
      const out: Media[] = [];
      try {
        if (m.photo) {
          const u = dataUrl(await dl(m), "image/jpeg");
          if (u) out.push({ type: "photo", url: u });
        } else if (m.videoNote) {
          out.push({ type: "roundvideo", thumb: dataUrl(await dl(m, { thumb: -1 }), "image/jpeg") });
        } else if (m.video || m.gif) {
          out.push({ type: "video", thumb: dataUrl(await dl(m, { thumb: -1 }), "image/jpeg") });
        } else if (m.voice) {
          // Голосовое — без данных, догрузим по кнопке (MTProto one-mode).
          out.push({ type: "voice" });
        } else if (m.audio) {
          const a = m.audio;
          let title: string | undefined, performer: string | undefined;
          for (const at of a.attributes ?? []) {
            if (at.title) title = at.title;
            if (at.performer) performer = at.performer;
            if (at.fileName && !title) title = at.fileName;
          }
          out.push({ type: "audio", title, performer });
        } else if (m.document && !m.sticker) {
          const doc = m.document;
          let name = "файл";
          for (const a of doc.attributes ?? []) if (a.fileName) name = a.fileName;
          const kb = numOf(doc.size) / 1024;
          const extra = kb >= 1024 ? (kb / 1024).toFixed(1) + " МБ" : kb >= 1 ? Math.round(kb) + " КБ" : undefined;
          out.push({ type: "document", title: name, extra });
        } else if (m.webPreview) {
          const w = m.webPreview;
          out.push({
            type: "link",
            href: w.url,
            site: w.siteName,
            title: w.title,
            description: w.description,
            image: w.photo ? dataUrl(await dl(w.photo), "image/jpeg") : undefined,
          });
        }
      } catch {
        /* пропускаем медиа */
      }
      return out;
    };

    const posts: Record<string, unknown>[] = [];
    const unavailable: string[] = [];
    const errs: string[] = [];

    for (const ch of channels) {
      if (timeLeft() < 1500) { unavailable.push(ch); continue; } // не успели — отдадим остальное
      try {
        // Резолвим username явно — getEntity на свежей сессии часто не находит пира.
        // deno-lint-ignore no-explicit-any
        // (getEntity под таймаутом ниже)
        // deno-lint-ignore no-explicit-any
        let entity: any;
        try {
          entity = await withTimeout(client.getEntity(ch), 7000);
        } catch {
          const res = await withTimeout(client.invoke(
            // deno-lint-ignore no-explicit-any
            new (tg as any).Api.contacts.ResolveUsername({ username: ch }),
          ), 7000);
          // deno-lint-ignore no-explicit-any
          entity = (res as any).chats?.[0] ?? (res as any).users?.[0];
          if (!entity) throw new Error("username не резолвится");
        }

        const channelTitle: string | undefined = entity.title || entity.username;
        let channelAvatar: string | undefined;
        try {
          if (timeLeft() > 3000) channelAvatar = dataUrl(await withTimeout(client.downloadProfilePhoto(entity), 5000), "image/jpeg");
        } catch {
          /* без аватарки */
        }

        // deno-lint-ignore no-explicit-any
        const msgs: any[] = await withTimeout(client.getMessages(entity, { limit: LIMIT } as any), 9000);
        if (!msgs?.length) {
          unavailable.push(ch);
          errs.push(ch + ": нет сообщений (возможно нужно вступить в канал)");
          continue;
        }

        // Склейка альбомов по grouped_id.
        // deno-lint-ignore no-explicit-any
        const groups = new Map<string, any[]>();
        const order: string[] = [];
        for (const m of msgs) {
          const key = m.groupedId ? "g" + m.groupedId.toString() : "s" + m.id;
          if (!groups.has(key)) {
            groups.set(key, []);
            order.push(key);
          }
          groups.get(key)!.push(m);
        }

        for (const key of order) {
          const group = groups.get(key)!;
          const withText = group.find((x) => x.message && x.message.length) ?? group[0];
          const text = stripReactions(entitiesToHtml(withText.message ?? "", withText.entities ?? []));
          const head = group[0];
          const media: Media[] = [];
          for (const m of group) if (m.media) media.push(...(await extract(m)));
          if (!text && media.length === 0) continue;
          posts.push({
            channel: ch,
            msgId: head.id,
            postedAt: new Date((head.date ?? 0) * 1000).toISOString(),
            text,
            hasMedia: media.length > 0,
            media,
            link: `https://t.me/${ch}/${head.id}`,
            channelTitle,
            channelAvatar,
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
    // 200 + error, чтобы реальный текст дошёл до клиента (он решит, падать ли на браузерный фолбэк).
    return json({ posts: [], unavailable: [], error: (e as Error).message || String(e) });
  }
});
