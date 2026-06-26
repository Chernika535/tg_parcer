// Клиентский «API»: всё работает в браузере, без бэкенда.
// Данные — в localStorage, чтение каналов — через CORS-прокси, отправка — Bot API.
import { feeds, digests, settings } from "./lib/storage.ts";
import { fetchManyChannels, type Post } from "./lib/scraper.ts";
import { buildDigest } from "./lib/digest.ts";
import { sendMessage, getLastChatId } from "./lib/telegram.ts";

export type { Post } from "./lib/scraper.ts";
export type { Digest, Settings } from "./lib/storage.ts";

export type FeedListItem = { id: number; title: string; channelCount: number };
export type FeedDetail = { feed: { id: number; title: string; channels: string[] }; posts: Post[] };

export const api = {
  async listFeeds(): Promise<FeedListItem[]> {
    return feeds.all().map((f) => ({ id: f.id, title: f.title, channelCount: f.channels.length }));
  },
  async createFeed(title: string) {
    const f = feeds.create(title);
    return { id: f.id, title: f.title };
  },
  async updateFeed(id: number, fields: { title?: string; channels?: string[] }) {
    feeds.update(id, fields);
    return { ok: true as const };
  },
  async deleteFeed(id: number) {
    feeds.remove(id);
    return { ok: true as const };
  },
  async getFeed(id: number, limit = 50): Promise<FeedDetail> {
    const f = feeds.get(id);
    if (!f) throw new Error("лента не найдена");
    const posts = await fetchManyChannels(f.channels);
    posts.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
    return { feed: { id: f.id, title: f.title, channels: f.channels }, posts: posts.slice(0, limit) };
  },

  async listDigests() {
    return digests.all();
  },
  async createDigest(d: Parameters<typeof digests.create>[0]) {
    return digests.create(d);
  },
  async updateDigest(id: number, fields: Parameters<typeof digests.update>[1]) {
    digests.update(id, fields);
    return { ok: true as const };
  },
  async deleteDigest(id: number) {
    digests.remove(id);
    return { ok: true as const };
  },
  async runDigest(id: number) {
    const d = digests.get(id);
    if (!d) throw new Error("парсинг не найден");
    const s = settings.get();
    if (!s.tg_chat_id) throw new Error("не подключён Telegram (chat_id)");
    if (!s.bot_token) throw new Error("не задан токен бота (Настройки)");
    const text = await buildDigest(d);
    if (!text) return { ok: true as const, sent: false };
    await sendMessage(s.bot_token, s.tg_chat_id, text);
    digests.update(id, { last_sent_at: new Date().toISOString() });
    return { ok: true as const, sent: true };
  },

  async getSettings() {
    return settings.get();
  },
  async updateSettings(fields: Partial<ReturnType<typeof settings.get>>) {
    settings.update(fields);
    return { ok: true as const };
  },
  async telegramConnect() {
    const s = settings.get();
    const chatId = await getLastChatId(s.bot_token);
    if (chatId == null)
      throw new Error("не нашёл сообщений. Откройте бота, отправьте /start и повторите.");
    settings.update({ tg_chat_id: chatId });
    return { chat_id: chatId };
  },
};
