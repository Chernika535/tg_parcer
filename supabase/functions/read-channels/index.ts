// Supabase Edge Function: серверное чтение публичных Telegram-каналов
// через https://t.me/s/<channel> (без CORS-проблем браузера).
import { DOMParser, type Element } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

type Post = {
  channel: string;
  msgId: number;
  postedAt: string;
  text: string;
  hasMedia: boolean;
  link: string;
};

const UA = "Mozilla/5.0 (compatible; FeedAggregator/1.0)";
const TIMEOUT_MS = 10000;
const CONCURRENCY = 5;

function normalize(input: string): string | null {
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^t\.me\//, "").replace(/^s\//, "").replace(/^@/, "");
  s = s.split(/[/?#]/)[0].replace(/[^a-z0-9_]/g, "");
  return s.length >= 3 && s.length <= 64 ? s : null;
}

function extractText(el: Element): string {
  const html = el.innerHTML.replace(/<br\s*\/?>/gi, "\n");
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const text = doc?.querySelector("div")?.textContent ?? el.textContent ?? "";
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parsePosts(html: string, username: string): Post[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return [];
  const posts: Post[] = [];
  for (const block of doc.querySelectorAll(".tgme_widget_message")) {
    try {
      const el = block as unknown as Element;
      const dataPost = el.getAttribute("data-post");
      if (!dataPost) continue;
      const msgId = Number(dataPost.split("/").pop());
      if (!Number.isFinite(msgId) || msgId <= 0) continue;

      const textEl = el.querySelector(".tgme_widget_message_text");
      const text = textEl ? extractText(textEl) : "";

      const timeEl = el.querySelector(".tgme_widget_message_date time");
      const datetime = timeEl?.getAttribute("datetime");
      if (!datetime) continue;

      const hasMedia =
        !!el.querySelector(".tgme_widget_message_photo") ||
        !!el.querySelector(".tgme_widget_message_video") ||
        !!el.querySelector(".tgme_widget_message_document") ||
        !!el.querySelector(".tgme_widget_message_link_preview");

      posts.push({
        channel: username,
        msgId,
        postedAt: new Date(datetime).toISOString(),
        text,
        hasMedia,
        link: `https://t.me/${username}/${msgId}`,
      });
    } catch {
      /* пропускаем битый пост */
    }
  }
  posts.sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  return posts;
}

async function fetchChannel(username: string): Promise<Post[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(`https://t.me/s/${username}`, {
      headers: { "user-agent": UA },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return [];
    const html = await res.text();
    if (!html.includes("tgme_")) return [];
    return parsePosts(html, username);
  } catch {
    return [];
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  try {
    const body = (await req.json()) as { channels?: string[] };
    const channels = [...new Set((body.channels ?? []).map(normalize).filter(Boolean) as string[])];
    if (channels.length === 0) return jsonResponse({ posts: [], unavailable: [] });

    const posts: Post[] = [];
    const unavailable: string[] = [];
    let i = 0;
    async function worker() {
      while (i < channels.length) {
        const ch = channels[i++];
        const p = await fetchChannel(ch);
        if (p.length === 0) unavailable.push(ch);
        else posts.push(...p);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, channels.length) }, worker),
    );

    posts.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
    return jsonResponse({ posts, unavailable });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
