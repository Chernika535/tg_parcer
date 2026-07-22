// SEO / превью для ссылки на отдельный пост (/post/:channel/:msgId).
// Отдаём боту мета-теги, живого пользователя перекидываем в SPA (#/post/..).
function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export default defineEventHandler((event) => {
  const chRaw = getRouterParam(event, "channel") ?? "";
  const ch = chRaw.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 64);
  const msgId = (getRouterParam(event, "msgId") ?? "").replace(/[^0-9]/g, "");
  const SITE = getRequestURL(event).origin;
  const hash = `/#/post/${encodeURIComponent(ch)}/${encodeURIComponent(msgId)}`;
  const url = `${SITE}/post/${esc(ch)}/${esc(msgId)}`;
  const title = `Пост из @${ch} — Полистай`;
  const desc = `Читайте этот пост из Telegram-канала @${ch} на сервисе «Полистай», без VPN.`;
  const img = SITE + "/og-cover.png";

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
<h1>Пост из @${esc(ch)}</h1>
<p><a href="${esc(hash)}">Открыть пост в приложении «Полистай»</a></p>
</body>
</html>`;
});
