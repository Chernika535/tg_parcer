import { sql } from "./db.ts";
import { fetchManyChannels } from "./scraper.ts";
import { escapeHtml } from "./telegram.ts";
import { mapPost } from "./feed.ts";
import type { Post } from "./util.ts";

export type Digest = {
  id: number;
  user_id: string;
  title: string;
  keywords: string[];
  channels: string[];
  send_hour: number;
  send_minute: number;
  enabled: boolean;
  last_sent_at: Date | null;
};

const PREVIEW_CHARS = 300;

/** Собирает текст сводки. text=null означает «нет подходящих постов — не слать». */
export async function buildDigest(d: Digest): Promise<{ ok: boolean; text: string | null }> {
  if (d.channels.length === 0) return { ok: true, text: null };

  await fetchManyChannels(d.channels);

  // Период: с last_sent_at, либо последние 24 часа.
  const since = d.last_sent_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await sql`
    SELECT channel, msg_id, posted_at, text, has_media, link
    FROM posts
    WHERE channel = ANY(${d.channels}) AND posted_at >= ${since.toISOString()}
    ORDER BY posted_at DESC
  `;
  const posts = rows.map(mapPost as never) as Post[];

  const kw = d.keywords.map((k) => k.toLowerCase()).filter(Boolean);
  const matched =
    kw.length === 0
      ? posts
      : posts.filter((p) => {
          const t = p.text.toLowerCase();
          return kw.some((k) => t.includes(k));
        });

  if (matched.length === 0) return { ok: true, text: null };

  return { ok: true, text: renderDigest(d, matched) };
}

function renderDigest(d: Digest, posts: Post[]): string {
  const now = new Date().toLocaleString("ru-RU");
  const lines: string[] = [];
  lines.push(`<b>📋 ${escapeHtml(d.title)}</b>`);
  lines.push(`<i>${escapeHtml(now)} · постов: ${posts.length}</i>`);

  for (const p of posts) {
    const time = new Date(p.postedAt).toLocaleString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });
    let body = p.text.slice(0, PREVIEW_CHARS);
    if (p.text.length > PREVIEW_CHARS) body += "…";
    lines.push(
      `\n<b>@${escapeHtml(p.channel)}</b> · ${escapeHtml(time)}${p.hasMedia ? " 🖼" : ""}\n` +
        `${escapeHtml(body)}\n` +
        `<a href="${escapeHtml(p.link)}">Открыть пост</a>`,
    );
  }

  return lines.join("\n");
}
