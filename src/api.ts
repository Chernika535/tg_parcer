// Тонкий клиент к /api. Никаких секретов на фронте.

export type Post = {
  channel: string;
  msgId: number;
  postedAt: string;
  text: string;
  hasMedia: boolean;
  link: string;
};

export type FeedListItem = { id: number; title: string; channelCount: number };
export type FeedDetail = { feed: { id: number; title: string; channels: string[] }; posts: Post[] };

export type Digest = {
  id: number;
  title: string;
  keywords: string[];
  channels: string[];
  send_hour: number;
  send_minute: number;
  enabled: boolean;
  last_sent_at: string | null;
};

export type Settings = { tg_chat_id: number | null; timezone: string };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  listFeeds: () => req<FeedListItem[]>("feeds"),
  createFeed: (title: string) =>
    req<{ id: number; title: string }>("feeds", { method: "POST", body: JSON.stringify({ title }) }),
  updateFeed: (id: number, fields: { title?: string; channels?: string[] }) =>
    req<{ ok: true }>("feeds", { method: "PATCH", body: JSON.stringify({ id, ...fields }) }),
  deleteFeed: (id: number) => req<{ ok: true }>(`feeds?id=${id}`, { method: "DELETE" }),
  getFeed: (id: number, limit = 50) => req<FeedDetail>(`feed?id=${id}&limit=${limit}`),

  listDigests: () => req<Digest[]>("digests"),
  createDigest: (d: Partial<Digest>) =>
    req<Digest>("digests", { method: "POST", body: JSON.stringify(d) }),
  updateDigest: (id: number, fields: Partial<Digest>) =>
    req<{ ok: true }>("digests", { method: "PATCH", body: JSON.stringify({ id, ...fields }) }),
  deleteDigest: (id: number) => req<{ ok: true }>(`digests?id=${id}`, { method: "DELETE" }),
  runDigest: (id: number) =>
    req<{ ok: boolean; sent: boolean }>("digests/run", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),

  getSettings: () => req<Settings>("settings"),
  updateSettings: (fields: Partial<Settings>) =>
    req<{ ok: true }>("settings", { method: "PATCH", body: JSON.stringify(fields) }),
  telegramConnect: () => req<{ chat_id: number }>("telegram-connect", { method: "POST" }),
};
