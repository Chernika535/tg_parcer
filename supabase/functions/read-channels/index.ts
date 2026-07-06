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
  | { type: "audio"; url?: string; title?: string; performer?: string }
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

// Экранируем текст как HTML (фронт рендерит тело поста через innerHTML).
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// HTML фрагмент из t.me/s → безопасный HTML с сохранением форматирования
// (b/i/u/s/code/blockquote/spoiler/ссылки). Всё прочее вырезаем, текст экранируем.
// Разрешённые теги временно кодируем символами приватной зоны Unicode (\uE0xx) —
// их не бывает в тексте, поэтому экранирование текста их не задевает.
const SN = (n: number) => String.fromCharCode(0xE000 + n);
function htmlToRich(html: string): string {
  const A_H = SN(1), A_T = SN(2), A_E = SN(3);   // ссылка: href / текст / конец
  const SP0 = SN(4), SP1 = SN(5);                // спойлер откр/закр
  const T = {
    b: [SN(6), SN(7)], i: [SN(8), SN(9)], u: [SN(10), SN(11)],
    s: [SN(12), SN(13)], c: [SN(14), SN(15)], q: [SN(16), SN(17)],
  };

  let s = html.replace(/<br\s*\/?>/gi, "\n");

  // Ссылки: внешние сохраняем, внутренние (#хэштеги, tg://…) → просто текст.
  s = s.replace(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
    const text = inner.replace(/<[^>]+>/g, "");
    if (!/^https?:\/\//i.test(href)) return text;
    return `${A_H}${href}${A_T}${text || href}${A_E}`;
  });

  // Спойлеры Telegram: элемент <tg-spoiler> или любой тег с классом-«spoiler».
  s = s.replace(/<tg-spoiler[^>]*>([\s\S]*?)<\/tg-spoiler>/gi, (_m, inner) => `${SP0}${inner}${SP1}`);
  s = s.replace(/<(span|i|b)[^>]*\bclass="[^"]*spoiler[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi,
    (_m, _t, inner) => `${SP0}${inner}${SP1}`);

  // Форматирующие теги → маркеры.
  const MAP: [RegExp, string][] = [
    [/<(?:b|strong)\b[^>]*>/gi, T.b[0]], [/<\/(?:b|strong)>/gi, T.b[1]],
    [/<(?:i|em)\b[^>]*>/gi, T.i[0]], [/<\/(?:i|em)>/gi, T.i[1]],
    [/<(?:u|ins)\b[^>]*>/gi, T.u[0]], [/<\/(?:u|ins)>/gi, T.u[1]],
    [/<(?:s|strike|del)\b[^>]*>/gi, T.s[0]], [/<\/(?:s|strike|del)>/gi, T.s[1]],
    [/<(?:code|pre)\b[^>]*>/gi, T.c[0]], [/<\/(?:code|pre)>/gi, T.c[1]],
    [/<blockquote\b[^>]*>/gi, T.q[0]], [/<\/blockquote>/gi, T.q[1]],
  ];
  for (const [reg, tok] of MAP) s = s.replace(reg, tok);

  // Абзацы → перенос, прочие теги убираем, декодируем сущности и экранируем текст.
  s = s.replace(/<\/(p|div)>/gi, "\n").replace(/<[^>]+>/g, "");
  s = esc(decodeEntities(s));

  // Возвращаем реальные безопасные теги.
  const rx = (a: string) => new RegExp(a, "g");
  s = s.replace(rx(`${A_H}([\\s\\S]*?)${A_T}([\\s\\S]*?)${A_E}`), (_m, href, text) =>
    `<a href="${String(href).replace(/"/g, "%22")}" target="_blank" rel="noreferrer">${text}</a>`);
  s = s.replace(rx(SP0), '<span class="tg-spoiler">').replace(rx(SP1), "</span>");
  const TAGS: [string, string, string][] = [
    [T.b[0], T.b[1], "b"], [T.i[0], T.i[1], "i"], [T.u[0], T.u[1], "u"],
    [T.s[0], T.s[1], "s"], [T.c[0], T.c[1], "code"], [T.q[0], T.q[1], "blockquote"],
  ];
  for (const [o, c, tag] of TAGS) s = s.replace(rx(o), `<${tag}>`).replace(rx(c), `</${tag}>`);

  return deboldWhole(s.split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trimEnd()).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim());
}

// Если жирным набран ВЕСЬ пост (стиль автора), в нашей ленте это читается тяжело
// — снимаем жирность. Частичное форматирование не трогаем.
function deboldWhole(html: string): string {
  const visible = (t: string) => t.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
  const total = visible(html);
  if (!total) return html;
  let bold = 0;
  html.replace(/<b>([\s\S]*?)<\/b>/gi, (_m, x) => { bold += visible(x); return _m; });
  return bold / total > 0.9 ? html.replace(/<\/?b>/gi, "") : html;
}

// Убираем «хвост» из реакций Telegram (эмодзи+число), если он попал в текст.
// ВАЖНО: один класс символов с одним квантором — без вложенных «+» (иначе ReDoS
// на длинных эмодзи-строках вешал функцию).
const REACT_ONLY = /^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\d\s,]+$/u;
function isReactionLine(line: string): boolean {
  const t = line.trim();
  if (t === "") return true;
  if (!/\d/.test(t)) return false;    // реакция всегда со счётчиком
  return REACT_ONLY.test(t);          // только эмодзи+цифры+пробелы
}
function stripReactions(text: string): string {
  const lines = text.split("\n");
  while (lines.length && isReactionLine(lines[lines.length - 1])) lines.pop();
  return lines.join("\n").trimEnd();
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

function channelMeta(html: string): { title?: string; avatar?: string; description?: string; subscribers?: string } {
  const head = html.slice(0, html.indexOf('class="tgme_channel_history') + 1 || 4000);
  const title = attr(head, /tgme_channel_info_header_title[^>]*>\s*<[^>]*>([^<]+)/i)
    || attr(head, /tgme_header_title[^>]*>\s*<[^>]*>([^<]+)/i)
    || attr(head, /tgme_channel_info_header_title[^>]*>([^<]+)/i);
  const avatar = attr(head, /tgme_page_photo_image[^>]*>\s*<img[^>]+src="([^"]+)"/i)
    || attr(html, /tgme_widget_message_owner_photo[^>]*>\s*<img[^>]+src="([^"]+)"/i)
    || attr(html, /<img[^>]*class="tgme_widget_message_user_photo[^"]*"[^>]+src="([^"]+)"/i);
  const descRaw = html.match(/tgme_channel_info_description[^>]*>([\s\S]*?)<\/div>/i)?.[1];
  const subscribers = attr(html, /tgme_channel_info_counter[^>]*>\s*<span class="counter_value"[^>]*>([^<]+)<\/span>\s*<span class="counter_type"[^>]*>subscribers/i);
  return {
    title: title ? decodeEntities(title.trim()) : undefined,
    avatar,
    description: descRaw ? htmlToText(descRaw) : undefined,
    subscribers: subscribers ? subscribers.trim() : undefined,
  };
}

// Только мета-инфо канала (название, ник, аватар, описание, подписчики) — без постов.
async function fetchChannelInfo(username: string): Promise<Record<string, unknown> | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(`https://t.me/s/${username}`, { headers: { "user-agent": UA }, signal: ctrl.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const html = await res.text();
    if (!html.includes("tgme_")) return null;
    const m = channelMeta(html);
    return { username, title: m.title, avatar: prox(m.avatar), description: m.description, subscribers: m.subscribers };
  } catch {
    return null;
  }
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
  // Музыка/аудиофайлы: отдельный виджет tgme_widget_message_audio (с исполнителем/
  // названием). Прямой ссылки на t.me/s обычно нет — догрузим по кнопке (MTProto).
  const isAudioWidget = /tgme_widget_message_audio\b/i.test(block) && !voice;
  const docTitle = attr(block, /tgme_widget_message_document_title[^>]*>([^<]+)/i);
  const docIsAudio = !!docTitle && (/\.(mp3|m4a|ogg|opus|wav|flac|aac|weba)\b/i.test(docTitle) || /^audio\b/i.test(docTitle.trim()));
  if (isAudioWidget || docIsAudio) {
    const title = attr(block, /tgme_widget_message_audio_title[^>]*>([^<]+)/i) || docTitle;
    const performer = attr(block, /tgme_widget_message_audio_performer[^>]*>([^<]+)/i);
    const aurl = block.match(/tgme_widget_message_audio[\s\S]*?<audio[^>]+src="([^"]+)"/i)?.[1];
    media.push({ type: "audio", url: prox(aurl), title: title ? decodeEntities(title.trim()) : undefined, performer: performer ? decodeEntities(performer.trim()) : undefined });
  }
  // Стикеры
  const sticker = block.match(/tgme_widget_message_sticker[^>]*data-webp="([^"]+)"/i)?.[1]
    || block.match(/tgme_widget_message_tgsticker[\s\S]*?<img[^>]+src="([^"]+)"/i)?.[1];
  if (sticker) media.push({ type: "sticker", url: prox(sticker)! });
  // Документы (кроме аудио, которое уже обработали выше)
  if (docTitle && !docIsAudio) {
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
    const tm = block.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>\s*(?:<(?:div|a) class="tgme_widget_message_(?:footer|reply|inline|reactions|link_preview)|<\/div>)/i)
      || block.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i);
    if (tm) {
      // Реакции и превью ссылки идут отдельными блоками после текста — если они
      // попали в захват, отрезаем всё от них, чтобы не приняли за часть поста.
      const raw = tm[1]
        .replace(/<(?:div|a)[^>]*class="[^"]*tgme_widget_message_reactions[\s\S]*$/i, "")
        .replace(/<a[^>]*class="[^"]*tgme_widget_message_link_preview[\s\S]*$/i, "");
      text = stripReactions(htmlToRich(raw));
    }

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

async function fetchChannelInner(username: string, before?: number): Promise<Post[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    // ?before=<msgId> отдаёт окно постов СТАРШЕ указанного — для подгрузки «ещё».
    const url = before && before > 0 ? `https://t.me/s/${username}?before=${before}` : `https://t.me/s/${username}`;
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: ctrl.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) return [];
    const html = await res.text();
    if (!html.includes("tgme_")) return [];
    return parsePosts(html, username);
  } catch {
    return [];
  }
}

function fetchChannel(username: string, before?: number): Promise<Post[]> {
  return Promise.race([
    fetchChannelInner(username, before),
    new Promise<Post[]>((resolve) => setTimeout(() => resolve([]), HARD_MS)),
  ]);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    let raw: string[] = [];
    let imgbase = "";
    let infoOnly = false;
    let cursors: { channel?: string; before?: number }[] = [];
    if (req.method === "GET") {
      const sp = new URL(req.url).searchParams;
      raw = (sp.get("channels") ?? "").split(",");
      imgbase = sp.get("imgbase") ?? "";
      infoOnly = sp.get("info") === "1";
    } else {
      const body = (await req.json().catch(() => ({}))) as {
        channels?: string[]; imgbase?: string; info?: boolean;
        cursors?: { channel?: string; before?: number }[];
      };
      raw = body.channels ?? [];
      imgbase = body.imgbase ?? "";
      infoOnly = !!body.info;
      cursors = body.cursors ?? [];
    }
    if (imgbase) IMG_BASE = imgbase;

    // Пагинация «ещё посты»: для каждого канала грузим окно старше указанного msgId.
    if (cursors.length > 0) {
      const items = cursors
        .map((c) => ({ ch: normalize(c.channel ?? ""), before: Number(c.before) || 0 }))
        .filter((c) => c.ch) as { ch: string; before: number }[];
      const out: Post[] = [];
      let j = 0;
      async function cworker() {
        while (j < items.length) {
          const it = items[j++];
          const p = await fetchChannel(it.ch, it.before);
          // Оставляем только посты СТАРШЕ курсора (на всякий случай отфильтруем сам курсор).
          out.push(...p.filter((x) => !it.before || x.msgId < it.before));
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, cworker));
      out.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
      return jsonResponse({ posts: out, unavailable: [] });
    }

    const channels = [...new Set(raw.map(normalize).filter(Boolean) as string[])];
    if (channels.length === 0) return jsonResponse(infoOnly ? { channels: [] } : { posts: [], unavailable: [] });

    // Режим «только инфо о каналах» (для карточек каналов и раскрытия состава ленты).
    if (infoOnly) {
      const infos = await Promise.all(channels.map(fetchChannelInfo));
      return jsonResponse({ channels: infos.filter(Boolean) });
    }

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
