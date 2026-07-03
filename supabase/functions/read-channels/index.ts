// Supabase Edge Function: серверное чтение публичных Telegram-каналов через
// https://t.me/s/<channel>. Парсим РЕГУЛЯРКАМИ, без deno-dom (его WASM грузится
// на холодном старте долго и функция не укладывается в лимит → "Failed to fetch").
// Вытаскиваем текст, фото, превью видео, голос, стикеры, превью ссылок, аватар.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
const TIMEOUT_MS = 8000;
const HARD_MS = 9000;
const CONCURRENCY = 8;

// База для прокси картинок задаётся клиентом (?imgbase=...): это либо домен
// Onreza (/sb), либо сам Supabase. Если не передана — берём свой адрес.
let IMG_BASE = Deno.env.get("SUPABASE_URL") ?? "";
function prox(url: string | undefined): string | undefined {
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) return url;
  if (!IMG_BASE) return url;
  // Декодим HTML-сущности (t.me/s кодирует & как &amp; в адресах) — иначе адрес битый.
  const clean = url.replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  return `${IMG_BASE.replace(/\/$/, "")}/functions/v1/img?u=${encodeURIComponent(clean)}`;
}

function normalize(input: string): string | null {
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^t\.me\//, "").replace(/^s\//, "").replace(/^@/, "");
  s = s.split(/[/?#]/)[0].replace(/[^a-z0-9_]/g, "");
  return s.length >= 3 && s.length <= 64 ? s : null;
}

const NAMED: Record<string, string> = {
  nbsp: " ", mdash: "—", ndash: "–", hellip: "…", laquo: "«", raquo: "»",
  quot: '"', apos: "'", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  bull: "•", middot: "·", deg: "°", copy: "©", reg: "®", trade: "™",
  lt: "<", gt: ">",
};
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; } })
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return _; } })
    .replace(/&([a-z]+);/gi, (m, name) => NAMED[name.toLowerCase()] ?? m)
    .replace(/&amp;/g, "&");
}

// HTML фрагмент текста → чистый текст с переносами строк.
// Ссылки-теги <a href="URL">текст</a> сохраняем как markdown [текст](URL),
// чтобы фронтенд сделал их кликабельными (иначе и текст, и адрес терялись).
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
        const text = inner.replace(/<[^>]+>/g, "").trim();
        // Внешние ссылки → markdown [текст](url). Внутренние (#хэштеги, ?q=, tg://)
        // оставляем просто текстом, иначе в ленте торчит сырой markdown.
        if (!/^https?:\/\//i.test(href)) return text;
        if (!text) return href;
        return text === href ? href : `[${text}](${href})`;
      })
      .replace(/<\/(p|div)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstBg(block: string, re: RegExp): string | undefined {
  const m = block.match(re);
  if (!m) return undefined;
  const s = m[0].match(/background-image\s*:\s*url\(['"]?([^'")]+)['"]?\)/i);
  return s?.[1];
}

function attr(block: string, re: RegExp): string | undefined {
  const m = block.match(re);
  return m?.[1];
}

function channelMeta(html: string): { title?: string; avatar?: string } {
  const head = html.slice(0, html.indexOf('class="tgme_channel_history') + 1 || 4000);
  const title = attr(head, /tgme_channel_info_header_title[^>]*>\s*<[^>]*>([^<]+)/i)
    || attr(head, /tgme_header_title[^>]*>\s*<[^>]*>([^<]+)/i)
    || attr(head, /tgme_channel_info_header_title[^>]*>([^<]+)/i);
  const avatar = attr(head, /tgme_page_photo_image[^>]*>\s*<img[^>]+src="([^"]+)"/i)
    || attr(html, /tgme_widget_message_owner_photo[^>]*>\s*<img[^>]+src="([^"]+)"/i)
    || attr(html, /<img[^>]*class="tgme_widget_message_user_photo[^"]*"[^>]+src="([^"]+)"/i);
  return { title: title ? decodeEntities(title.trim()) : undefined, avatar };
}

function extractMedia(block: string): Media[] {
  const media: Media[] = [];

  // Фото
  for (const m of block.matchAll(/tgme_widget_message_photo_wrap[^>]*style="([^"]*)"/gi)) {
    const u = m[1].match(/background-image\s*:\s*url\(['"]?([^'")]+)['"]?\)/i)?.[1];
    if (u) media.push({ type: "photo", url: prox(u)! });
  }
  // Видео (превью + src если есть)
  for (const m of block.matchAll(/tgme_widget_message_video_player[\s\S]*?(?=tgme_widget_message_video_player|tgme_widget_message_footer|$)/gi)) {
    const seg = m[0];
    const thumb = seg.match(/tgme_widget_message_video_thumb[^>]*style="[^"]*background-image\s*:\s*url\(['"]?([^'")]+)['"]?\)/i)?.[1];
    const url = seg.match(/<video[^>]+src="([^"]+)"/i)?.[1];
    media.push({ type: "video", url: prox(url), thumb: prox(thumb) });
  }
  // Кружочки
  const round = block.match(/tgme_widget_message_roundvideo[\s\S]*?(?=tgme_widget_message_footer|$)/i)?.[0];
  if (round) {
    const thumb = round.match(/background-image\s*:\s*url\(['"]?([^'")]+)['"]?\)/i)?.[1];
    const url = round.match(/<video[^>]+src="([^"]+)"/i)?.[1];
    media.push({ type: "roundvideo", url: prox(url), thumb: prox(thumb) });
  }
  // Голосовые
  const voice = block.match(/<audio[^>]*tgme_widget_message_voice[^>]*src="([^"]+)"/i)?.[1]
    || block.match(/tgme_widget_message_voice[^>]*>[\s\S]*?<audio[^>]+src="([^"]+)"/i)?.[1];
  if (voice) media.push({ type: "voice", url: prox(voice) });
  // Стикеры
  const sticker = block.match(/tgme_widget_message_sticker[^>]*data-webp="([^"]+)"/i)?.[1]
    || block.match(/tgme_widget_message_tgsticker[\s\S]*?<img[^>]+src="([^"]+)"/i)?.[1];
  if (sticker) media.push({ type: "sticker", url: prox(sticker)! });
  // Документы
  const docTitle = attr(block, /tgme_widget_message_document_title[^>]*>([^<]+)/i);
  if (docTitle) {
    const extra = attr(block, /tgme_widget_message_document_extra[^>]*>([^<]+)/i);
    media.push({ type: "document", title: decodeEntities(docTitle.trim()), extra: extra ? decodeEntities(extra.trim()) : undefined });
  }
  // Превью ссылки
  if (/tgme_widget_message_link_preview/i.test(block)) {
    const seg = block.match(/tgme_widget_message_link_preview[\s\S]*?(?=tgme_widget_message_footer|$)/i)?.[0] ?? block;
    media.push({
      type: "link",
      href: attr(block, /tgme_widget_message_link_preview"\s+href="([^"]+)"/i),
      site: attr(seg, /link_preview_site_name[^>]*>([^<]+)/i),
      title: attr(seg, /link_preview_title[^>]*>([^<]+)/i),
      description: attr(seg, /link_preview_description[^>]*>([\s\S]*?)<\/div>/i)?.replace(/<[^>]+>/g, "").trim(),
      image: prox(firstBg(seg, /link_preview_image[^>]*style="[^"]*"/i)),
    });
  }
  return media;
}

function parsePosts(html: string, username: string): Post[] {
  const meta = channelMeta(html);
  const posts: Post[] = [];
  // Режем на блоки сообщений по data-post.
  const parts = html.split(/<div class="tgme_widget_message[ "]/);
  for (const block of parts) {
    const dataPost = attr(block, /data-post="([^"]+)"/);
    if (!dataPost) continue;
    const msgId = Number(dataPost.split("/").pop());
    if (!Number.isFinite(msgId) || msgId <= 0) continue;
    const datetime = attr(block, /tgme_widget_message_date[\s\S]*?datetime="([^"]+)"/i) || attr(block, /datetime="([^"]+)"/i);
    if (!datetime) continue;

    // Текст
    let text = "";
    const tm = block.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>\s*(?:<div class="tgme_widget_message_(?:footer|reply|inline)|<\/div>)/i)
      || block.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i);
    if (tm) text = htmlToText(tm[1]);

    const media = extractMedia(block);
    const views = attr(block, /tgme_widget_message_views[^>]*>([^<]+)/i);

    posts.push({
      channel: username,
      msgId,
      postedAt: new Date(datetime).toISOString(),
      text,
      hasMedia: media.length > 0,
      media,
      link: `https://t.me/${username}/${msgId}`,
      views: views ? views.trim() : undefined,
      channelTitle: meta.title,
      channelAvatar: prox(meta.avatar),
    });
  }
  posts.sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  return posts.slice(-20);
}

async function fetchChannelInner(username: string): Promise<Post[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(`https://t.me/s/${username}`, { headers: { "user-agent": UA }, signal: ctrl.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) return [];
    const html = await res.text();
    if (!html.includes("tgme_")) return [];
    return parsePosts(html, username);
  } catch {
    return [];
  }
}

function fetchChannel(username: string): Promise<Post[]> {
  return Promise.race([
    fetchChannelInner(username),
    new Promise<Post[]>((resolve) => setTimeout(() => resolve([]), HARD_MS)),
  ]);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    let raw: string[] = [];
    let imgbase = "";
    if (req.method === "GET") {
      const sp = new URL(req.url).searchParams;
      raw = (sp.get("channels") ?? "").split(",");
      imgbase = sp.get("imgbase") ?? "";
    } else {
      const body = (await req.json().catch(() => ({}))) as { channels?: string[]; imgbase?: string };
      raw = body.channels ?? [];
      imgbase = body.imgbase ?? "";
    }
    if (imgbase) IMG_BASE = imgbase;
    const channels = [...new Set(raw.map(normalize).filter(Boolean) as string[])];
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
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, channels.length) }, worker));
    posts.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
    return jsonResponse({ posts, unavailable });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
