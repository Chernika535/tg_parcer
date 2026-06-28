// Чтение каналов без превью (MTProto) ПРЯМО В БРАУЗЕРЕ через GramJS.
// На Supabase Edge тяжёлый пакет telegram падает на импорте (крэш изолята),
// поэтому читаем там же, где и логинимся — в браузере. Сессию читающего
// аккаунта (одноразового) выдаёт edge-функция tg-connect/get_session.
import { getReadSession, type Post } from "./data.ts";

const API_ID = 2040;
const API_HASH = "b18441a1ff607e10a989891a5462e627";
const LIMIT = 20;

type MTResult = {
  posts: Post[];
  unavailable: string[];
  noAccount?: boolean;
  error?: string;
  note?: string;
};

export async function readChannelsMT(channels: string[]): Promise<MTResult> {
  if (channels.length === 0) return { posts: [], unavailable: [] };

  let session: string | null;
  try {
    session = await getReadSession();
  } catch (e) {
    // Не вошёл / нет доступа — закрытые каналы читать нечем.
    return { posts: [], unavailable: channels, noAccount: true, error: (e as Error).message };
  }
  if (!session) return { posts: [], unavailable: channels, noAccount: true };

  // deno-lint-ignore no-explicit-any
  let client: any;
  try {
    const { TelegramClient } = await import("telegram");
    const { StringSession } = await import("telegram/sessions");
    client = new TelegramClient(new StringSession(session), API_ID, API_HASH, {
      connectionRetries: 3,
    });
    await client.connect();
  } catch (e) {
    return { posts: [], unavailable: channels, error: "Подключение MTProto: " + (e as Error).message };
  }

  const posts: Post[] = [];
  const unavailable: string[] = [];
  const errs: string[] = [];

  for (const ch of channels) {
    try {
      // GramJS в браузере резолвит @username сам.
      const msgs = await client.getMessages(ch, { limit: LIMIT });
      if (!msgs || msgs.length === 0) {
        unavailable.push(ch);
        errs.push(ch + ": нет сообщений (возможно нужно вступить в канал)");
        continue;
      }
      // deno-lint-ignore no-explicit-any
      for (const m of msgs as any[]) {
        const text: string = m.message ?? "";
        const hasMedia = !!m.media;
        if (!text && !hasMedia) continue;
        posts.push({
          channel: ch,
          msgId: m.id,
          postedAt: new Date((m.date ?? 0) * 1000).toISOString(),
          text,
          hasMedia,
          media: [],
          link: `https://t.me/${ch}/${m.id}`,
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

  posts.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
  return { posts, unavailable, note: errs.length ? errs.join(" | ") : undefined };
}
