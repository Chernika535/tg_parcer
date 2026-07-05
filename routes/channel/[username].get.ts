// SEO / превью ссылок для страницы канала (/channel/:username). Аналогично ленте:
// боту отдаём мета-теги канала, живого пользователя перекидываем в SPA (#/channel/..).
function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

type ChannelInfo = { username: string; title?: string; avatar?: string; description?: string; subscribers?: string };

export default defineEventHandler(async (event) => {
  const raw = getRouterParam(event, "username") ?? "";
  const uname = raw.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 64);
  const hash = `/#/channel/${encodeURIComponent(uname)}`;
  const SITE = getRequestURL(event).origin;
  const DEFAULT_IMG = SITE + "/og-cover.png";

  let info: ChannelInfo | null = null;
  try {
    const origin = SITE;
    const cfg = (await $fetch("/config.json", { baseURL: origin }).catch(() => null)) as
      | { supabaseUrl?: string; supabaseAnonKey?: string }
      | null;
    const base = process.env.SUPABASE_URL || cfg?.supabaseUrl || "https://kklxahjnptrgnwcrpauh.supabase.co";
    const key = cfg?.supabaseAnonKey || process.env.SUPABASE_ANON_KEY || "";
    const data = (await $fetch(`${base}/functions/v1/read-channels`, {
      query: { apikey: key, channels: uname, info: "1", imgbase: base },
    }).catch(() => null)) as { channels?: ChannelInfo[] } | null;
    info = data?.channels?.[0] ?? null;
  } catch {
    /* нет данных — дефолтные мета + редирект */
  }

  const name = info?.title || `@${uname}`;
  const title = `${name} — канал в «Полистай»`;
  const descBase = info?.description?.trim() || `Канал @${uname} в Telegram.`;
  const desc = `${descBase} Читайте посты канала и добавляйте его в свои ленты на сервисе «Полистай», без VPN.`.slice(0, 300);
  const img = info?.avatar && /^https?:\/\//i.test(info.avatar) ? info.avatar : DEFAULT_IMG;
  const url = `${SITE}/channel/${esc(uname)}`;

  setResponseHeader(event, "content-type", "text/html; charset=utf-8");
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${esc(url)}" />
<meta property="og:type" content="profile" />
<meta property="og:site_name" content="Полистай" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${esc(url)}" />
<meta property="og:image" content="${esc(img)}" />
<meta property="og:locale" content="ru_RU" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(desc)}" />
<meta name="twitter:image" content="${esc(img)}" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<script>location.replace(${JSON.stringify(hash)});</script>
<noscript><meta http-equiv="refresh" content="0; url=${esc(hash)}" /></noscript>
</head>
<body>
<h1>${esc(name)}</h1>
<p>${esc(descBase)}</p>
<p><a href="${esc(hash)}">Открыть канал в приложении «Полистай»</a></p>
</body>
</html>`;
});
