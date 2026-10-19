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

  // 3) Карта сайта — настоящий файл.
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n")}
</urlset>`;
  writeFile("sitemap.xml", sitemap);

  console.log(`[prerender] готово: ${feeds.length} лент, ${chanList.length} каналов, sitemap с ${urls.length} адресами.`);
}

main().catch((e) => { console.error("[prerender] ошибка:", e); process.exit(1); });
