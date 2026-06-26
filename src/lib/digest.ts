import { fetchManyChannels, type Post } from "./scraper.ts";
import { escapeHtml } from "./telegram.ts";
import type { Digest } from "./storage.ts";

const PREVIEW_CHARS = 300;

/** Собирает текст сводки клиентски. null = нет подходящих постов. */
export async function buildDigest(d: Digest): Promise<string | null> {
  if (d.channels.length === 0) return null;

  const posts = await fetchManyChannels(d.channels);
  const since = d.last_sent_at
    ? new Date(d.last_sent_at)
    : new Date(Date.now() - 24 * 60 * 60 * 1000);

  const inWindow = posts.filter((p) => new Date(p.postedAt) >= since);
  inWindow.sort((a, b) => b.postedAt.localeCompare(a.postedAt));

  const kw = d.keywords.map((k) => k.toLowerCase()).filter(Boolean);
  const matched =
    kw.length === 0
      ? inWindow
      : inWindow.filter((p) => {
          const t = p.text.toLowerCase();
          return kw.some((k) => t.includes(k));
        });

  if (matched.length === 0) return null;
  return render(d, matched);
}

function render(d: Digest, posts: Post[]): string {
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
