import { sql } from "./db.ts";
import { fetchManyChannels } from "./scraper.ts";
import type { Post } from "./util.ts";

export type FeedMeta = {
  id: number;
  title: string;
  channels: string[];
};

export async function getFeed(
  feedId: number,
  userId: string,
  limit: number,
): Promise<{ feed: FeedMeta; posts: Post[] } | null> {
  const feedRows = await sql<{ id: number; title: string }[]>`
    SELECT id, title FROM feeds WHERE id = ${feedId} AND user_id = ${userId}
  `;
  if (feedRows.length === 0) return null;

  const channelRows = await sql<{ username: string }[]>`
    SELECT username FROM feed_channels WHERE feed_id = ${feedId} ORDER BY username
  `;
  const channels = channelRows.map((r) => r.username);

  // Обновляем кэш и таблицу posts (ошибки отдельных каналов проглатываются внутри).
  if (channels.length > 0) {
    await fetchManyChannels(channels);
  }

  // Читаем из БД, чтобы переживать перезапуски функции и подмешивать ранее собранные посты.
  const posts =
    channels.length === 0
      ? []
      : await sql<DbPost[]>`
          SELECT channel, msg_id, posted_at, text, has_media, link
          FROM posts
          WHERE channel = ANY(${channels})
          ORDER BY posted_at DESC
          LIMIT ${limit}
        `.then((rows) => rows.map(mapPost));

  return { feed: { id: feedRows[0].id, title: feedRows[0].title, channels }, posts };
}

type DbPost = {
  channel: string;
  msg_id: string | number;
  posted_at: Date;
  text: string;
  has_media: boolean;
  link: string;
};

export function mapPost(r: DbPost): Post {
  return {
    channel: r.channel,
    msgId: Number(r.msg_id),
    postedAt: new Date(r.posted_at).toISOString(),
    text: r.text,
    hasMedia: r.has_media,
    link: r.link,
  };
}
