// Чтение каналов без превью (MTProto) ПРЯМО В БРАУЗЕРЕ через GramJS.
// На Supabase Edge тяжёлый пакет telegram падает на импорте (крэш изолята),
// поэтому читаем там же, где и логинимся — в браузере. Сессию читающего
// аккаунта (одноразового) выдаёт edge-функция tg-connect/get_session.
// Медиа (фото/видео/кружки/голосовые/стикеры) скачиваются и превращаются
// в blob-URL — у MTProto нет готовых ссылок, как у t.me/s.
import { getReadSession, type Post, type Media } from "./data.ts";

const API_ID = 2040;
const API_HASH = "b18441a1ff607e10a989891a5462e627";
const LIMIT = 20;
const MAX_VIDEO = 30 * 1024 * 1024; // крупнее не качаем — даём ссылку

type MTResult = {
  posts: Post[];
  unavailable: string[];
  noAccount?: boolean;
  error?: string;
  note?: string;
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(label + " (таймаут " + ms / 1000 + "с)")), ms)),
  ]);
}

// deno-lint-ignore no-explicit-any
function toUrl(buf: any, mime: string): string | undefined {
  if (!buf || (buf.length ?? 0) === 0) return undefined;
  try {
    return URL.createObjectURL(new Blob([buf], { type: mime }));
  } catch {
    return undefined;
  }
}

// deno-lint-ignore no-explicit-any
async function dl(client: any, target: any, opts?: Record<string, unknown>): Promise<unknown> {
  try {
    return await withTimeout(client.downloadMedia(target, opts ?? {}), 30000, "медиа не скачалось");
  } catch {
    return undefined;
  }
}

function num(v: unknown): number {
  try {
    return typeof v === "bigint" ? Number(v) : Number(v ?? 0);
  } catch {
    return 0;
  }
}

// Извлекает медиа одного сообщения в наш формат Media[].
// deno-lint-ignore no-explicit-any
async function extractMedia(client: any, m: any): Promise<Media[]> {
  const out: Media[] = [];
  try {
    if (m.photo) {
      const u = toUrl(await dl(client, m), "image/jpeg");
      if (u) out.push({ type: "photo", url: u });
    } else if (m.sticker) {
      const mime: string = m.sticker.mimeType || "";
      const animated = mime.includes("tgsticker") || mime.includes("webm");
      if (animated) {
        // .tgs/.webm не покажем как картинку — берём превью.
        const t = toUrl(await dl(client, m, { thumb: -1 }), "image/webp");
        if (t) out.push({ type: "sticker", url: t });
      } else {
        const u = toUrl(await dl(client, m), "image/webp");
        if (u) out.push({ type: "sticker", url: u });
      }
    } else if (m.voice) {
      const u = toUrl(await dl(client, m), "audio/ogg");
      if (u) out.push({ type: "voice", url: u });
    } else if (m.audio) {
      const u = toUrl(await dl(client, m), m.audio.mimeType || "audio/mpeg");
      if (u) out.push({ type: "voice", url: u });
    } else if (m.videoNote) {
      const thumb = toUrl(await dl(client, m, { thumb: -1 }), "image/jpeg");
      const size = num(m.videoNote.size);
      const url = size && size <= MAX_VIDEO ? toUrl(await dl(client, m), "video/mp4") : undefined;
      out.push({ type: "roundvideo", url, thumb });
    } else if (m.video || m.gif) {
      const doc = m.video || m.gif;
      const thumb = toUrl(await dl(client, m, { thumb: -1 }), "image/jpeg");
      const size = num(doc.size);
      const url = size && size <= MAX_VIDEO ? toUrl(await dl(client, m), doc.mimeType || "video/mp4") : undefined;
      out.push({ type: "video", url, thumb });
    } else if (m.document) {
      const doc = m.document;
      let name = "файл";
      for (const a of doc.attributes ?? []) if (a.fileName) name = a.fileName;
      const kb = num(doc.size) / 1024;
      const extra = kb >= 1024 ? (kb / 1024).toFixed(1) + " МБ" : kb >= 1 ? Math.round(kb) + " КБ" : undefined;
      out.push({ type: "document", title: name, extra });
    } else if (m.webPreview) {
      const w = m.webPreview;
      let image: string | undefined;
      if (w.photo) image = toUrl(await dl(client, w.photo), "image/jpeg");
      out.push({
        type: "link",
        href: w.url,
        site: w.siteName,
        title: w.title,
        description: w.description,
        image,
      });
    }
  } catch {
    /* медиа пропускаем молча */
  }
  return out;
}

export async function readChannelsMT(
  channels: string[],
  onPost?: (p: Post) => void,
): Promise<MTResult> {
  if (channels.length === 0) return { posts: [], unavailable: [] };

  let session: string | null;
  try {
    session = await getReadSession();
  } catch (e) {
    return { posts: [], unavailable: channels, noAccount: true, error: (e as Error).message };
  }
  if (!session) return { posts: [], unavailable: channels, noAccount: true };

  // deno-lint-ignore no-explicit-any
  let client: any;
  try {
    const { TelegramClient } = await import("telegram");
    const { StringSession } = await import("telegram/sessions");
    client = new TelegramClient(new StringSession(session), API_ID, API_HASH, {
      connectionRetries: 2,
    });
    await withTimeout(client.connect(), 20000, "не удалось подключиться к Telegram");
  } catch (e) {
    return { posts: [], unavailable: channels, error: "Подключение MTProto: " + (e as Error).message };
  }

  const posts: Post[] = [];
  const unavailable: string[] = [];
  const errs: string[] = [];

  for (const ch of channels) {
    try {
      // Шапка канала: название + аватарка (качается один раз).
      let channelTitle: string | undefined;
      let channelAvatar: string | undefined;
      try {
        // deno-lint-ignore no-explicit-any
        const entity: any = await withTimeout(client.getEntity(ch), 15000, "канал не резолвится");
        channelTitle = entity.title || entity.username;
        try {
          const ph = await withTimeout(client.downloadProfilePhoto(entity), 15000, "avatar");
          channelAvatar = toUrl(ph, "image/jpeg");
        } catch {
          /* без аватарки — не критично */
        }
      } catch {
        /* без шапки — не критично */
      }

      // deno-lint-ignore no-explicit-any
      const msgs: any[] = await withTimeout<any[]>(client.getMessages(ch, { limit: LIMIT }), 20000, "канал не отвечает");
      if (!msgs || msgs.length === 0) {
        unavailable.push(ch);
        errs.push(ch + ": нет сообщений (возможно нужно вступить в канал)");
        continue;
      }

      // Группируем альбомы (одинаковый grouped_id) в один пост.
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
        const text = group.map((x) => x.message).find((t) => t && t.length) ?? "";
        const head = group[0];
        const media: Media[] = [];
        for (const m of group) {
          if (m.media) media.push(...(await extractMedia(client, m)));
        }
        if (!text && media.length === 0) continue;
        const post: Post = {
          channel: ch,
          msgId: head.id,
          postedAt: new Date((head.date ?? 0) * 1000).toISOString(),
          text,
          hasMedia: media.length > 0,
          media,
          link: `https://t.me/${ch}/${head.id}`,
          channelTitle,
          channelAvatar,
        };
        posts.push(post);
        onPost?.(post); // отдаём пост сразу — чтобы появлялся в ленте по мере загрузки
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

  posts.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
  return { posts, unavailable, note: errs.length ? errs.join(" | ") : undefined };
}
