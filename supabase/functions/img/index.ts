// Прокси картинок Telegram через сервер Supabase. В России t.me/CDN Telegram
// доступны только через VPN, поэтому браузер не должен ходить туда напрямую.
// Эта функция скачивает картинку на сервере и отдаёт её клиенту — без VPN.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
};

// Блокируем только явно «внутренние»/localhost адреса (чтобы прокси нельзя было
// использовать против внутренней сети). Любые публичные https-картинки пропускаем —
// раньше слишком строгий список хостов резал валидные адреса Telegram-CDN.
const BLOCKED_HOST = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|::1$|0\.0\.0\.0$)/i;

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
    if (target.protocol !== "https:" || BLOCKED_HOST.test(target.hostname)) {
      return new Response("host not allowed", { status: 403, headers: cors });
    }

    const range = req.headers.get("range");
    const reqHeaders = {
      "user-agent": "Mozilla/5.0 (compatible; FeedAggregator/1.0)",
      ...(range ? { range } : {}),
    };
    // Связь Supabase→Telegram нестабильна — несколько попыток скачать картинку.
    let upstream: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        const r = await fetch(target.toString(), { redirect: "follow", signal: ctrl.signal, headers: reqHeaders })
          .finally(() => clearTimeout(timer));
        if (r.ok || r.status === 206) { upstream = r; break; }
        upstream = r; // не-ок ответ запомним, но попробуем ещё
      } catch {
        /* таймаут/обрыв — повторим */
      }
      if (attempt < 2) await new Promise((res) => setTimeout(res, 500));
    }
    if (!upstream) return new Response("upstream failed", { status: 502, headers: cors });

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
