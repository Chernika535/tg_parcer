// SEO / превью ссылок для отдельной ленты. SPA на HashRouter (#/feed/:id) не даёт
// соцсетям и поисковикам увидеть заголовок/описание конкретной ленты — они режут
// всё после #. Поэтому по «чистому» адресу /feed/:id сервер отдаёт HTML с мета-
// тегами именно этой ленты (для ботов), а живого пользователя перекидывает в SPA.
const SITE = "https://tgparser-feed.onreza.app";
const DEFAULT_IMG = SITE + "/og-cover.png";

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

type Feed = {
  title?: string;
  description?: string | null;
  cover_url?: string | null;
  channels?: string[];
  author_name?: string | null;
};

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id") ?? "";
  const hash = `/#/feed/${encodeURIComponent(id)}`;

  let feed: Feed | null = null;
  try {
    const origin = getRequestURL(event).origin;
    const cfg = (await $fetch("/config.json", { baseURL: origin }).catch(() => null)) as
      | { supabaseUrl?: string; supabaseAnonKey?: string }
      | null;
    const base = process.env.SUPABASE_URL || cfg?.supabaseUrl || "https://kklxahjnptrgnwcrpauh.supabase.co";
    const key = cfg?.supabaseAnonKey || process.env.SUPABASE_ANON_KEY || "";
    const data = (await $fetch(`${base}/functions/v1/feeds`, {
      query: { apikey: key, action: "get", id },
    }).catch(() => null)) as { feed?: Feed } | null;
    feed = data?.feed ?? null;
  } catch {
    /* нет данных — отдадим дефолтные мета + редирект */
  }

  const title = feed?.title ? `${feed.title} — Полистай` : "Лента — Полистай";
  const descBase = feed?.description?.trim()
    || (feed?.channels?.length ? `Подборка из ${feed.channels.length} Telegram-каналов.` : "Подборка Telegram-каналов.");
  const desc = `${descBase} Читайте в одном месте на сервисе «Полистай», без VPN.`.slice(0, 300);
  const img = feed?.cover_url && /^https?:\/\//i.test(feed.cover_url) ? feed.cover_url : DEFAULT_IMG;
  const url = `${SITE}/feed/${esc(id)}`;

  setResponseHeader(event, "content-type", "text/html; charset=utf-8");
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${esc(url)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Полистай" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${esc(url)}" />
<meta property="og:image" content="${esc(img)}" />
<meta property="og:locale" content="ru_RU" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(desc)}" />
<meta name="twitter:image" content="${esc(img)}" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<script>location.replace(${JSON.stringify(hash)});</script>
<noscript><meta http-equiv="refresh" content="0; url=${esc(hash)}" /></noscript>
</head>
<body>
<h1>${esc(feed?.title || "Лента")}</h1>
<p>${esc(descBase)}</p>
<p><a href="${esc(hash)}">Открыть ленту в приложении «Полистай»</a></p>
</body>
</html>`;
});
