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

    const body = (await req.json()) as { channels?: string[]; one?: { channel?: string; msgId?: number } };

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
        } else if (m.document && !m.voice && !m.audio && !m.sticker) {
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
          const text = group.map((x) => x.message).find((t: string) => t && t.length) ?? "";
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
