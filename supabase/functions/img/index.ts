// Прокси картинок Telegram через сервер Supabase. В России t.me/CDN Telegram
// доступны только через VPN, поэтому браузер не должен ходить туда напрямую.
// Эта функция скачивает картинку на сервере и отдаёт её клиенту — без VPN.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
};

// Разрешаем только хосты Telegram (чтобы прокси нельзя было использовать как открытый релей).
const ALLOWED = [
  /(^|\.)cdn-telegram\.org$/i,
  /(^|\.)cdn\d*\.telesco\.pe$/i,
  /(^|\.)telesco\.pe$/i,
  /(^|\.)t\.me$/i,
  /(^|\.)telegram\.org$/i,
  /(^|\.)web\.telegram\.org$/i,
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const u = new URL(req.url).searchParams.get("u");
    if (!u) return new Response("no url", { status: 400, headers: cors });
    let target: URL;
    try {
      target = new URL(u);
    } catch {
      return new Response("bad url", { status: 400, headers: cors });
    }
    if (target.protocol !== "https:" || !ALLOWED.some((re) => re.test(target.hostname))) {
      return new Response("host not allowed", { status: 403, headers: cors });
    }

    const range = req.headers.get("range");
    const upstream = await fetch(target.toString(), {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; FeedAggregator/1.0)",
        ...(range ? { range } : {}),
      },
    });

    const headers = new Headers(cors);
    const ct = upstream.headers.get("content-type");
    if (ct) headers.set("content-type", ct);
    const cr = upstream.headers.get("content-range");
    if (cr) headers.set("content-range", cr);
    const ar = upstream.headers.get("accept-ranges");
    if (ar) headers.set("accept-ranges", ar);
    headers.set("cache-control", "public, max-age=86400");

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e) {
    return new Response("proxy error: " + (e as Error).message, { status: 502, headers: cors });
  }
});
