import { parse, type HTMLElement } from "node-html-parser";
import { kv } from "./kv.ts";
import { sql } from "./db.ts";
import type { Post } from "./util.ts";

// TTL горячего кэша страницы канала. 10 минут — бережём трафик (лимит 1 ГБ/мес).
export const CACHE_TTL_SECONDS = 600;
const FETCH_TIMEOUT_MS = 10_000;
const CONCURRENCY = 5;
const USER_AGENT = "Mozilla/5.0 (compatible; FeedAggregator/1.0)";

/**
 * Читает последние посты публичного канала через https://t.me/s/<username>.
 * Никогда не бросает на сетевых/разметочных проблемах — возвращает [] и логирует.
 */
export async function fetchChannelPosts(username: string): Promise<Post[]> {
  const cacheKey = `tme:${username}`;

  const cached = await kv.getJSON<Post[]>(cacheKey);
  if (cached) return cached;

  let html: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`https://t.me/s/${username}`, {
      headers: { "user-agent": USER_AGENT },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      console.warn(`[scraper] ${username}: HTTP ${res.status} — канал недоступен`);
      return [];
    }
    html = await res.text();
  } catch (e) {
    console.warn(`[scraper] ${username}: ошибка сети`, (e as Error).message);
    return [];
  }

  const posts = parsePosts(html, username);

  if (posts.length === 0) {
    if (html && html.includes("tgme_")) {
      // Разметка есть, но постов не извлекли — возможно поменялись селекторы.
      console.warn(`[scraper] ${username}: 0 постов из непустого HTML // SCRAPER: markup changed?`);
    } else {
      console.warn(`[scraper] ${username}: нет постов (приватный / без превью / удалён)`);
    }
    return [];
  }

  // Кэш в KV + UPSERT в posts параллельно.
  await Promise.all([
    kv.setJSON(cacheKey, posts, CACHE_TTL_SECONDS),
    upsertPosts(posts),
  ]);

  return posts;
}

export function parsePosts(html: string, username: string): Post[] {
  let root: HTMLElement;
  try {
    root = parse(html);
  } catch {
    return [];
  }

  const blocks = root.querySelectorAll(".tgme_widget_message");
  const posts: Post[] = [];

  for (const block of blocks) {
    try {
      const dataPost = block.getAttribute("data-post"); // "<channel>/<id>"
      if (!dataPost) continue;
      const msgId = Number(dataPost.split("/").pop());
      if (!Number.isFinite(msgId) || msgId <= 0) continue;

      const textEl = block.querySelector(".tgme_widget_message_text");
      const text = textEl ? extractText(textEl) : "";

      const timeEl = block.querySelector(".tgme_widget_message_date time");
      const datetime = timeEl?.getAttribute("datetime");
      if (!datetime) continue;
      const postedAt = new Date(datetime).toISOString();

      const hasMedia =
        block.querySelector(".tgme_widget_message_photo") != null ||
        block.querySelector(".tgme_widget_message_video") != null ||
        block.querySelector(".tgme_widget_message_document") != null ||
        block.querySelector(".tgme_widget_message_link_preview") != null;

      posts.push({
        channel: username,
        msgId,
        postedAt,
        text,
        hasMedia,
        link: `https://t.me/${username}/${msgId}`,
      });
    } catch {
      // один битый пост не должен ронять разбор страницы
      continue;
    }
  }

  posts.sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  return posts;
}

function extractText(el: HTMLElement): string {
  // Сохраняем переносы строк по <br>, схлопываем горизонтальные пробелы.
  const withBreaks = el.innerHTML.replace(/<br\s*\/?>/gi, "\n");
  const stripped = parse(withBreaks).structuredText || parse(withBreaks).text;
  return stripped
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function upsertPosts(posts: Post[]): Promise<void> {
  if (posts.length === 0) return;
  try {
    for (const p of posts) {
      await sql`
        INSERT INTO posts (channel, msg_id, posted_at, text, has_media, link)
        VALUES (${p.channel}, ${p.msgId}, ${p.postedAt}, ${p.text}, ${p.hasMedia}, ${p.link})
        ON CONFLICT (channel, msg_id)
        DO UPDATE SET text = EXCLUDED.text,
                      has_media = EXCLUDED.has_media,
                      posted_at = EXCLUDED.posted_at,
                      fetched_at = now()
      `;
    }
  } catch (e) {
    console.warn("[scraper] upsert posts failed", (e as Error).message);
  }
}

/** Тянет несколько каналов параллельно с ограничением конкурентности. */
export async function fetchManyChannels(usernames: string[]): Promise<Post[]> {
  const unique = [...new Set(usernames)];
  const results: Post[] = [];
  let i = 0;

  async function worker() {
    while (i < unique.length) {
      const idx = i++;
      const posts = await fetchChannelPosts(unique[idx]).catch(() => []);
      results.push(...posts);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker);
  await Promise.all(workers);
  return results;
}
