// Пре-генерация SEO-страниц для СТАТИЧЕСКОГО деплоя (Onreza отдаёт dist/ как есть,
// сервер не запускает — поэтому серверные маршруты Nitro не работают). Здесь на
// сборке мы делаем настоящие файлы:
//   dist/sitemap.xml
//   dist/feed/<id>/index.html          — уникальные мета конкретной ленты
//   dist/channel/<username>/index.html — уникальные мета конкретного канала
// Каждый такой HTML отдаёт боту заголовок/описание/JSON-LD именно этой страницы,
// а живого пользователя перекидывает в SPA (#/feed/.. или #/channel/..).
//
// Данные берём из тех же Supabase-функций, что и раньше (feeds action=public,
// read-channels info=1). Новые ленты/каналы попадут в индекс со следующим деплоем.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const DIST = resolve(process.cwd(), "dist");
const SITE = (process.env.SITE_URL || "https://polistay.online").replace(/\/+$/, "");
const DEFAULT_IMG = SITE + "/og-cover.png";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function normCh(c) {
  return (c || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^t\.me\//, "").replace(/^s\//, "").replace(/^@/, "")
    .split(/[/?#]/)[0].replace(/[^a-z0-9_]/g, "");
}

function writeFile(rel, body) {
  const full = resolve(DIST, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

// Используем настоящий HTML Vite, включая JS/CSS приложения.
const appHtml = readFileSync(resolve(DIST, "index.html"), "utf8");
function pageHtml({ title, desc, url, img, h1, p, ogType, twCard, ld }) {
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="${esc(ogType)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(img)}" />`,
    `<meta name="twitter:card" content="${esc(twCard)}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
    `<meta name="twitter:image" content="${esc(img)}" />`,
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`,
  ].join("\n");
  return appHtml
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\s+name="description"[^>]*>/i, "")
    .replace(/<link\s+rel="canonical"[^>]*>/i, "")
    .replace(/<meta\s+property="og:(?:type|title|description|url|image)"[^>]*>/gi, "")
    .replace(/<meta\s+name="twitter:(?:card|title|description|image)"[^>]*>/gi, "")
    .replace(/<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/i, "")
    .replace("</head>", tags + "\n</head>")
    .replace(/<div id="root">[\s\S]*?<\/div>/, `<div id="root"><main><h1>${esc(h1)}</h1><p>${esc(p)}</p></main></div>`);
}

async function main() {
  let base = "https://kklxahjnptrgnwcrpauh.supabase.co";
  let key = "";
  try {
    const cfg = JSON.parse(readFileSync(resolve(DIST, "config.json"), "utf8"));
    base = process.env.SUPABASE_URL || cfg.supabaseUrl || base;
    key = cfg.supabaseAnonKey || process.env.SUPABASE_ANON_KEY || "";
  } catch {
    console.warn("[prerender] нет dist/config.json — беру дефолтный Supabase");
  }

  const urls = [
    { loc: `${SITE}/` },
    { loc: `${SITE}/feeds` },
    { loc: `${SITE}/tags` },
  ];

  // 1) Публичные ленты.
  let feeds = [];
  try {
    const r = await fetch(`${base}/functions/v1/feeds?apikey=${encodeURIComponent(key)}&action=public`);
    const data = await r.json();
    feeds = Array.isArray(data?.feeds) ? data.feeds : [];
  } catch (e) {
    console.warn("[prerender] не удалось получить публичные ленты:", e.message);
  }

  const chans = new Set();
  for (const f of feeds) {
    const id = String(f.id);
    const url = `${SITE}/feed/${esc(id)}`;
    const title = f.title ? `${f.title} — Полистай` : "Лента — Полистай";
    const descBase = (f.description && f.description.trim())
      || (f.channels?.length ? `Подборка из ${f.channels.length} Telegram-каналов.` : "Подборка Telegram-каналов.");
    const desc = `${descBase} Читайте в одном месте на сервисе «Полистай», без VPN.`.slice(0, 300);
    const img = f.cover_url && /^https?:\/\//i.test(f.cover_url) ? f.cover_url : DEFAULT_IMG;
    writeFile(`feed/${id}/index.html`, pageHtml({
      title, desc, url, img, ogType: "article", twCard: "summary_large_image",
      h1: f.title || "Лента", p: descBase,
      ld: {
        "@context": "https://schema.org", "@type": "CollectionPage",
        name: title, description: desc, url, inLanguage: "ru",
        isPartOf: { "@type": "WebSite", name: "Полистай", url: SITE },
      },
    }));
    urls.push({ loc: url, lastmod: (f.updated_at || f.created_at)?.slice(0, 10) });
    for (const c of f.channels ?? []) { const n = normCh(c); if (n.length >= 3) chans.add(n); }
  }

  // 2) Каналы из публичных лент — тянем инфо пачкой (title/avatar/description).
  const chanList = [...chans];
  let infoByName = {};
  if (chanList.length) {
    try {
      const q = new URLSearchParams({ apikey: key, channels: chanList.join(","), info: "1", imgbase: base });
      const r = await fetch(`${base}/functions/v1/read-channels?${q}`);
      const data = await r.json();
      for (const c of data?.channels ?? []) {
        if (c?.username) infoByName[String(c.username).toLowerCase()] = c;
      }
    } catch (e) {
      console.warn("[prerender] не удалось получить инфо каналов:", e.message);
    }
  }

  for (const uname of chanList) {
    const info = infoByName[uname] || {};
    const url = `${SITE}/channel/${esc(uname)}`;
    const name = info.title || `@${uname}`;
    const title = `${name} — канал в «Полистай»`;
    const descBase = (info.description && info.description.trim()) || `Канал @${uname} в Telegram.`;
    const desc = `${descBase} Читайте посты канала и добавляйте его в свои ленты на сервисе «Полистай», без VPN.`.slice(0, 300);
    const img = info.avatar && /^https?:\/\//i.test(info.avatar) ? info.avatar : DEFAULT_IMG;
    writeFile(`channel/${uname}/index.html`, pageHtml({
      title, desc, url, img, ogType: "profile", twCard: "summary",
      h1: name, p: descBase,
      ld: {
        "@context": "https://schema.org", "@type": "WebPage",
        name: title, description: desc, url, inLanguage: "ru",
        isPartOf: { "@type": "WebSite", name: "Полистай", url: SITE },
      },
    }));
    urls.push({ loc: url });
  }


  // 3) Индивидуальные SEO-страницы свежих публичных постов.
  // Берём только каналы из одобренных не-18+ лент; не публикуем закрытые источники.
  let postCount = 0;
  const publicChannels = new Set();
  for (const feed of feeds) {
    if (feed.adult) continue;
    for (const raw of feed.channels ?? []) {
      const name = normCh(raw);
      if (name.length >= 3) publicChannels.add(name);
    }
  }
  const MAX_POSTS = 3000;
  const POST_BATCH = 10;
  for (const name of publicChannels) {
    if (postCount >= MAX_POSTS) break;
    try {
      const q = new URLSearchParams({ apikey: key, channels: name });
      const response = await fetch(`${base}/functions/v1/read-channels?${q}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const posts = Array.isArray(data?.posts) ? data.posts.slice(0, POST_BATCH) : [];
      for (const post of posts) {
        if (postCount >= MAX_POSTS) break;
        const channel = normCh(post.channel);
        const msgId = Number(post.msgId);
        if (channel !== name || !Number.isSafeInteger(msgId) || msgId <= 0) continue;
        const rawText = String(post.text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        const channelName = String(post.channelTitle || infoByName[name]?.title || `@${name}`);
        const title = (rawText ? rawText.slice(0, 85) : `Публикация канала ${channelName}`) + " — Полистай";
        const desc = (rawText || `Пост Telegram-канала ${channelName} на сервисе «Полистай».`).slice(0, 300);
        const url = `${SITE}/post/${channel}/${msgId}`;
        const imageMedia = Array.isArray(post.media) ? post.media.find((m) => m?.type === "photo" && /^https?:\/\//.test(m.url || "")) : null;
        const img = imageMedia?.url || DEFAULT_IMG;
        const date = typeof post.postedAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(post.postedAt) ? post.postedAt : undefined;
        writeFile(`post/${channel}/${msgId}/index.html`, pageHtml({
          title, desc, url, img, ogType: "article", twCard: "summary_large_image",
          h1: channelName, p: desc,
          ld: {
            "@context": "https://schema.org", "@type": "SocialMediaPosting",
            headline: title, articleBody: rawText.slice(0, 5000),
            url, inLanguage: "ru",
            author: { "@type": "Organization", name: channelName },
            ...(date ? { datePublished: date } : {}),
            isPartOf: { "@type": "WebSite", name: "Полистай", url: SITE },
          },
        }));
        urls.push({ loc: url, ...(date ? { lastmod: date.slice(0, 10) } : {}) });
        postCount++;
      }
    } catch (error) {
      console.warn(`[prerender] посты канала ${name} пропущены:`, error.message);
    }
  }



  // SEO-страницы опубликованных материалов блога.
  urls.push({ loc: SITE + "/blog" });
  try {
    const response = await fetch(base.replace(/\\/$/, "") + "/rest/v1/blog_posts?select=*&status=eq.published&order=published_at.desc&limit=100", {
      headers: { apikey: key, authorization: "Bearer " + key },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const articles = await response.json();
    const listing = [];
    for (const a of articles) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.slug || "")) continue;
      const url = SITE + "/blog/" + a.slug;
      const desc = a.seo_description || a.excerpt || "";
      const image = /^https?:\\/\\//.test(a.cover_url || "") ? a.cover_url : DEFAULT_IMG;
      const body = (a.blocks || []).map((b) => {
        if (b.type === "heading") return "<h2>" + esc(b.text) + "</h2>";
        if (b.type === "quote") return "<blockquote>" + esc(b.text) + "</blockquote>";
        if (b.type === "image" && /^https?:\\/\\//.test(b.url || "")) return '<figure><img src="' + esc(b.url) + '" alt="' + esc(b.caption) + '"/><figcaption>' + esc(b.caption) + '</figcaption></figure>';
        if (b.type === "video" && /^https?:\\/\\//.test(b.url || "")) return '<p><a href="' + esc(b.url) + '">' + esc(b.caption || "Видео") + "</a></p>";
        return "<p>" + esc(b.text) + "</p>";
      }).join("");
      const html = pageHtml({
        title:a.seo_title || a.title + " — Блог Полистай", desc, url, img:image,
        h1:a.title, p:a.excerpt, ogType:"article", twCard:"summary_large_image",
        ld:{"@context":"https://schema.org","@type":"BlogPosting",headline:a.title,description:desc,url,image,datePublished:a.published_at,inLanguage:"ru",publisher:{"@type":"Organization",name:"Полистай"}},
      }).replace("</main></div>", body + "</main></div>");
      writeFile("blog/" + a.slug + "/index.html", html);
      urls.push({ loc:url, ...(a.published_at ? {lastmod:a.published_at.slice(0,10)} : {}) });
      listing.push('<article><h2><a href="/blog/' + a.slug + '">' + esc(a.title) + '</a></h2><p>' + esc(a.excerpt) + '</p></article>');
    }
    writeFile("blog/index.html", pageHtml({
      title:"Блог Полистай — статьи и новости",desc:"Журнал проекта Полистай",url:SITE + "/blog",img:DEFAULT_IMG,
      h1:"Блог Полистай",p:"Статьи о Telegram-каналах и цифровой культуре",
      ogType:"website",twCard:"summary_large_image",ld:{"@context":"https://schema.org","@type":"Blog",name:"Блог Полистай"}
    }).replace("</main></div>",listing.join("") + "</main></div>"));
  } catch (e) { console.warn("[prerender] блог:", e.message); }

  // Главная страница: индексируемый HTML с настоящими публичными подборками.
  const homeTitle = "Полистай — находи Telegram-каналы, собирай ленты и делись подборками";
  const homeDesc = "У каждого свой интернет. Находи интересные Telegram-каналы, заглядывай в чужие подборки и собирай собственные ленты. Читай бесплатно прямо в браузере.";
  const homeSections = [
    ["А что листают другие?", "Чужие интересы — отдельный вид искусства. Загляни в готовые подборки Telegram-каналов."],
    ["Твой вкус. Твои правила.", "Собери любимые публичные Telegram-каналы в одну ленту. Назови её, выбери обложку и поделись ссылкой."],
    ["Можно к тебе в голову?", "Чужой интернет — публичные подборки людей и редакции Полистай."],
    ["Меньше переключений. Больше интересного.", "Одна лента вместо двадцати каналов. Избранное и папки. Читай Telegram-каналы прямо в браузере."],
    ["Куда занесёт сегодня?", "Искусство, книги, дизайн, мода, кино и другие темы."],
    ["Не только листать. Ещё и писать.", "Для авторов доступны редактор постов, медиа и отложенная публикация через Telegram-бота."],
    ["Ладно, а как это работает?", "Полистай — независимый бесплатный веб-сервис для публичного Telegram-контента, не связанный с Telegram."],
    ["Ну что, покажешь?", "Не держи хороший интернет при себе. Создай собственную подборку или посмотри чужие."],
  ];
  const homeFeeds = feeds.filter((f) => !f.adult).slice(0, 24);
  const homeMarkup = `<main><h1>У каждого свой интернет.</h1><p>А какой у тебя? Кто-то залипает в искусство, кто-то ищет музыку, следит за модой или собирает находки со всего интернета. Полистай — место, где можно находить Telegram-каналы, собирать их в свои ленты и заглядывать в подборки других людей.</p><p><a href="/feeds">Заглянуть в чужой интернет</a> · <a href="/my/new">Собрать свой</a></p>${homeSections.map(([heading, body]) => `<section><h2>${esc(heading)}</h2><p>${esc(body)}</p></section>`).join("")}<section><h2>Реальные подборки</h2>${homeFeeds.map((f) => `<article><h3><a href="/feed/${encodeURIComponent(String(f.id))}">${esc(f.title || "Подборка")}</a></h3><p>${esc(f.description || "")} · ${(f.channels || []).length} каналов</p></article>`).join("")}</section><nav><a href="/feeds">Подборки</a> <a href="/tags">Темы</a> <a href="/author">Для авторов</a> <a href="/privacy">Политика конфиденциальности</a></nav></main>`;
  const homeTags = [
    `<title>${esc(homeTitle)}</title>`,
    `<meta name="description" content="${esc(homeDesc)}" />`,
    `<meta property="og:title" content="${esc(homeTitle)}" />`,
    `<meta property="og:description" content="${esc(homeDesc)}" />`,
    `<meta name="twitter:title" content="${esc(homeTitle)}" />`,
    `<meta name="twitter:description" content="${esc(homeDesc)}" />`,
  ].join("\n");
  const homeHtml = appHtml
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\s+name="description"[\s\S]*?\/>/i, "")
    .replace(/<meta\s+property="og:(?:title|description)"[\s\S]*?\/>/gi, "")
    .replace(/<meta\s+name="twitter:(?:title|description)"[\s\S]*?\/>/gi, "")
    .replace("</head>", homeTags + "\n</head>")
    .replace(/<div id="root">[\s\S]*?<\/div>/, `<div id="root">${homeMarkup}</div>`);
  writeFile("index.html", homeHtml);

  // 4) Карта сайта — настоящий файл.
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n")}
</urlset>`;
  writeFile("sitemap.xml", sitemap);

  console.log(`[prerender] готово: ${feeds.length} лент, ${chanList.length} каналов, ${postCount} постов, sitemap с ${urls.length} адресами.`);
}

main().catch((e) => { console.error("[prerender] ошибка:", e); process.exit(1); });
