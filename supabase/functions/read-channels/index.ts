// Supabase Edge Function: серверное чтение публичных Telegram-каналов
// через https://t.me/s/<channel>. Вытаскивает текст, медиа (фото/видео/голос/
// кружок/стикер/документ/превью ссылки), аватар и название канала.
import { DOMParser, type Element } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

type Media =
  | { type: "photo"; url: string }
  | { type: "video"; url?: string; thumb?: string }
  | { type: "roundvideo"; url?: string; thumb?: string }
  | { type: "voice"; url?: string }
  | { type: "sticker"; url: string }
  | { type: "document"; title: string; extra?: string }
  | { type: "link"; href?: string; site?: string; title?: string; description?: string; image?: string };

type Post = {
  channel: string;
  msgId: number;
  postedAt: string;
  text: string;
  hasMedia: boolean;
  media: Media[];
  link: string;
  views?: string;
  channelTitle?: string;
  channelAvatar?: string;
};

const UA = "Mozilla/5.0 (compatible; FeedAggregator/1.0)";
const TIMEOUT_MS = 9000;
const CONCURRENCY = 8;

// Прокси картинок Telegram через наш сервер — чтобы они грузились в России без VPN.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
function prox(url: string | undefined): string | undefined {
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) return url; // относительные/data: не трогаем
  if (!SUPABASE_URL) return url;
  return `${SUPABASE_URL}/functions/v1/img?u=${encodeURIComponent(url)}`;
}

function normalize(input: string): string | null {
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^t\.me\//, "").replace(/^s\//, "").replace(/^@/, "");
  s = s.split(/[/?#]/)[0].replace(/[^a-z0-9_]/g, "");
  return s.length >= 3 && s.length <= 64 ? s : null;
}

function bgUrl(style: string | null): string | undefined {
  if (!style) return undefined;
  const m = style.match(/background-image\s*:\s*url\(['"]?([^'")]+)['"]?\)/i);
  return m?.[1];
}

function extractText(el: Element): string {
  const html = el.innerHTML.replace(/<br\s*\/?>/gi, "\n");
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const text = doc?.querySelector("div")?.textContent ?? el.textContent ?? "";
  return text.split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractMedia(el: Element): Media[] {
  const media: Media[] = [];
  try {
    for (const ph of el.querySelectorAll("a.tgme_widget_message_photo_wrap")) {
      const url = bgUrl((ph as Element).getAttribute("style"));
      if (url) media.push({ type: "photo", url });
    }
    for (const vp of el.querySelectorAll(".tgme_widget_message_video_player")) {
      const e = vp as Element;
      const url = e.querySelector("video")?.getAttribute("src") ?? undefined;
      const thumb = bgUrl(e.querySelector(".tgme_widget_message_video_thumb")?.getAttribute("style") ?? null);
      media.push({ type: "video", url, thumb });
    }
    // кружочки (video note) — отдельная разметка
    for (const rv of el.querySelectorAll(".tgme_widget_message_roundvideo_player")) {
      const e = rv as Element;
      const url = e.querySelector("video")?.getAttribute("src") ?? undefined;
      const thumb = bgUrl(e.querySelector(".tgme_widget_message_roundvideo_thumb")?.getAttribute("style") ?? null);
      media.push({ type: "roundvideo", url, thumb });
    }
    for (const v of el.querySelectorAll("audio.tgme_widget_message_voice")) {
      media.push({ type: "voice", url: (v as Element).getAttribute("src") ?? undefined });
    }
    for (const st of el.querySelectorAll("i.tgme_widget_message_sticker, picture.tgme_widget_message_tgsticker img")) {
      const e = st as Element;
      const url = bgUrl(e.getAttribute("style")) ?? e.getAttribute("data-webp") ?? e.getAttribute("src") ?? undefined;
      if (url) media.push({ type: "sticker", url });
    }
    for (const d of el.querySelectorAll(".tgme_widget_message_document")) {
      const e = d as Element;
      const title = e.querySelector(".tgme_widget_message_document_title")?.textContent?.trim();
      const extra = e.querySelector(".tgme_widget_message_document_extra")?.textContent?.trim();
      if (title) media.push({ type: "document", title, extra: extra ?? undefined });
    }
    const lp = el.querySelector("a.tgme_widget_message_link_preview");
    if (lp) {
      const e = lp as Element;
      media.push({
        type: "link",
        href: e.getAttribute("href") ?? undefined,
        site: e.querySelector(".link_preview_site_name")?.textContent?.trim(),
        title: e.querySelector(".link_preview_title")?.textContent?.trim(),
        description: e.querySelector(".link_preview_description")?.textContent?.trim(),
        image: bgUrl(e.querySelector(".link_preview_image")?.getAttribute("style") ?? null),
      });
    }
  } catch { /* медиа не критичны */ }
  return media;
}

type Doc = ReturnType<DOMParser["parseFromString"]>;
function parseChannelMeta(doc: Doc): { title?: string; avatar?: string } {
  if (!doc) return {};
  const title = doc.querySelector(".tgme_channel_info_header_title")?.textContent?.trim()
    ?? doc.querySelector(".tgme_header_title")?.textContent?.trim();
  const avatar = doc.querySelector(".tgme_channel_info .tgme_page_photo_image img")?.getAttribute("src")
    ?? doc.querySelector(".tgme_page_photo_image img")?.getAttribute("src")
    ?? doc.querySelector("img.tgme_widget_message_owner_photo")?.getAttribute("src")
    ?? undefined;
  return { title: title ?? undefined, avatar: avatar ?? undefined };
}

function parsePosts(html: string, username: string): Post[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return [];
  const meta = parseChannelMeta(doc);
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
      const media = extractMedia(el).map((m): Media => {
        switch (m.type) {
          case "photo":
          case "sticker":
            return { ...m, url: prox(m.url)! };
          case "video":
          case "roundvideo":
            return { ...m, url: prox(m.url), thumb: prox(m.thumb) };
          case "voice":
            return { ...m, url: prox(m.url) };
          case "link":
            return { ...m, image: prox(m.image) };
          default:
            return m;
        }
      });
      const views = el.querySelector(".tgme_widget_message_views")?.textContent?.trim();

      posts.push({
        channel: username,
        msgId,
        postedAt: new Date(datetime).toISOString(),
        text,
        hasMedia: media.length > 0,
        media,
        link: `https://t.me/${username}/${msgId}`,
        views: views ?? undefined,
        channelTitle: meta.title,
        channelAvatar: prox(meta.avatar),
      });
    } catch { /* пропускаем битый пост */ }
  }
  posts.sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  return posts;
}

async function fetchChannel(username: string): Promise<Post[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(`https://t.me/s/${username}`, { headers: { "user-agent": UA }, signal: ctrl.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) return [];
    const html = await res.text();
    if (!html.includes("tgme_")) return [];
    return parsePosts(html, username);
  } catch { return []; }
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
        if (p.length === 0) unavailable.push(ch); else posts.push(...p);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, channels.length) }, worker));
    posts.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
    return jsonResponse({ posts, unavailable });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
