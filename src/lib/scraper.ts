// Браузерный скрапер t.me/s/<channel>. Прямой fetch к t.me блокирует CORS,
// поэтому ходим через бесплатные публичные CORS-прокси (с фоллбэком).
// Парсинг — нативным DOMParser, без зависимостей в бандле.

export type Post = {
  channel: string;
  msgId: number;
  postedAt: string;
  text: string;
  hasMedia: boolean;
  link: string;
};

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 минут — бережём трафик прокси
const FETCH_TIMEOUT_MS = 15000;

// Прокси пробуем по очереди, пока один не вернёт страницу с постами.
const PROXIES: ((u: string) => string)[] = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://thingproxy.freeboard.io/fetch/${u}`,
];

type CacheEntry = { ts: number; posts: Post[] };

function cacheGet(channel: string): Post[] | null {
  try {
    const raw = localStorage.getItem(`tme:${channel}`);
    if (!raw) return null;
    const e = JSON.parse(raw) as CacheEntry;
    if (Date.now() - e.ts > CACHE_TTL_MS) return null;
    return e.posts;
  } catch {
    return null;
  }
}

function cacheSet(channel: string, posts: Post[]) {
  try {
    localStorage.setItem(`tme:${channel}`, JSON.stringify({ ts: Date.now(), posts }));
  } catch {
    /* quota — игнорируем */
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  for (const wrap of PROXIES) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(wrap(url), { signal: ctrl.signal }).finally(() =>
        clearTimeout(timer),
      );
      if (!res.ok) continue;
      const html = await res.text();
      if (html && html.includes("tgme_")) return html;
    } catch {
      /* пробуем следующий прокси */
    }
  }
  return null;
}

export function parsePosts(html: string, username: string): Post[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks = doc.querySelectorAll(".tgme_widget_message");
  const posts: Post[] = [];

  blocks.forEach((block) => {
    try {
      const dataPost = block.getAttribute("data-post");
      if (!dataPost) return;
      const msgId = Number(dataPost.split("/").pop());
      if (!Number.isFinite(msgId) || msgId <= 0) return;

      const textEl = block.querySelector(".tgme_widget_message_text");
      const text = textEl ? extractText(textEl) : "";

      const timeEl = block.querySelector(".tgme_widget_message_date time");
      const datetime = timeEl?.getAttribute("datetime");
      if (!datetime) return;
      const postedAt = new Date(datetime).toISOString();

      const hasMedia =
        !!block.querySelector(".tgme_widget_message_photo") ||
        !!block.querySelector(".tgme_widget_message_video") ||
        !!block.querySelector(".tgme_widget_message_document") ||
        !!block.querySelector(".tgme_widget_message_link_preview");

      posts.push({
        channel: username,
        msgId,
        postedAt,
        text,
        hasMedia,
        link: `https://t.me/${username}/${msgId}`,
      });
    } catch {
      /* один битый пост не должен ронять страницу */
    }
  });

  posts.sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  return posts;
}

function extractText(el: Element): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = el.innerHTML.replace(/<br\s*\/?>/gi, "\n");
  const text = tmp.textContent || "";
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Один канал: кэш → прокси → парсинг. Никогда не бросает. */
export async function fetchChannelPosts(username: string): Promise<Post[]> {
  const cached = cacheGet(username);
  if (cached) return cached;

  const html = await fetchHtml(`https://t.me/s/${username}`);
  if (!html) {
    console.warn(`[scraper] ${username}: недоступен (прокси/приватный/без превью)`);
    return [];
  }
  const posts = parsePosts(html, username);
  if (posts.length === 0) {
    console.warn(`[scraper] ${username}: 0 постов // SCRAPER: markup changed?`);
    return [];
  }
  cacheSet(username, posts);
  return posts;
}

/** Несколько каналов с ограничением конкурентности. */
export async function fetchManyChannels(usernames: string[]): Promise<Post[]> {
  const unique = [...new Set(usernames)];
  const results: Post[] = [];
  let i = 0;
  const CONCURRENCY = 4;

  async function worker() {
    while (i < unique.length) {
      const idx = i++;
      const posts = await fetchChannelPosts(unique[idx]).catch(() => []);
      results.push(...posts);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker),
  );
  return results;
}
