// Прокси картинок Telegram через сервер Supabase. В России t.me/CDN Telegram
// доступны только через VPN, поэтому браузер не должен ходить туда напрямую.
// Эта функция скачивает картинку на сервере и отдаёт её клиенту — без VPN.
//
// «Память»: первую загрузку кладём в наш Storage (bucket imgcache) и дальше
// отдаём из него — Telegram дёргается один раз на картинку. Кэшируем только
// изображения ≤ 1.2 МБ (аватарки/превью/фото). Старое (>30 дней) чистим сами.
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
};

const BLOCKED_HOST = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|::1$|0\.0\.0\.0$)/i;

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const svc = SB_URL && SB_SERVICE ? createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } }) : null;
const BUCKET = "imgcache";
const CACHE_MAX = Math.round(1.2 * 1024 * 1024); // кэшируем картинки не больше 1.2 МБ
const TTL_MS = 30 * 24 * 3600 * 1000;            // храним 30 дней

async function keyFor(u: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(u));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Раз в ~сотню запросов подчищаем самые старые записи кэша (без крона, best-effort).
function maybeCleanup(): void {
  if (!svc || Math.random() > 0.01) return;
  (async () => {
    try {
      const { data } = await svc.storage.from(BUCKET).list("", { limit: 100, sortBy: { column: "created_at", order: "asc" } });
      const cutoff = Date.now() - TTL_MS;
      const old = (data ?? []).filter((o) => o.created_at && new Date(o.created_at).getTime() < cutoff).map((o) => o.name);
      if (old.length) await svc.storage.from(BUCKET).remove(old);
    } catch { /* не критично */ }
  })();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const u = new URL(req.url).searchParams.get("u");
    if (!u) return new Response("no url", { status: 400, headers: cors });
    let target: URL;
    try { target = new URL(u); } catch { return new Response("bad url", { status: 400, headers: cors }); }
    if (target.protocol !== "https:" || BLOCKED_HOST.test(target.hostname)) {
      return new Response("host not allowed", { status: 403, headers: cors });
    }

    const range = req.headers.get("range");
    // Декодируем адрес так же, как при отдаче, чтобы ключ кэша был стабильным.
    const clean = u.replace(/&amp;/g, "&");
    const key = svc && !range ? await keyFor(clean) : "";

    // 1) Отдаём из кэша, если уже сохранено (быстро и стабильно, без Telegram).
    if (svc && key) {
      try {
        const { data: blob } = await svc.storage.from(BUCKET).download(key);
        if (blob) {
          const buf = new Uint8Array(await blob.arrayBuffer());
          maybeCleanup();
          const h = new Headers(cors);
          h.set("content-type", blob.type || "image/jpeg");
          h.set("cache-control", "public, max-age=604800");
          return new Response(buf, { status: 200, headers: h });
        }
      } catch { /* нет в кэше — качаем ниже */ }
    }

    // 2) Качаем с Telegram (несколько попыток — связь бывает нестабильна).
    const reqHeaders = {
      "user-agent": "Mozilla/5.0 (compatible; FeedAggregator/1.0)",
      ...(range ? { range } : {}),
    };
    let upstream: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        const r = await fetch(target.toString(), { redirect: "follow", signal: ctrl.signal, headers: reqHeaders })
          .finally(() => clearTimeout(timer));
        if (r.ok || r.status === 206) { upstream = r; break; }
        upstream = r;
      } catch { /* повторим */ }
      if (attempt < 2) await new Promise((res) => setTimeout(res, 500));
    }
    if (!upstream) return new Response("upstream failed", { status: 502, headers: cors });

    const ct = upstream.headers.get("content-type") || "";
    const headers = new Headers(cors);
    if (ct) headers.set("content-type", ct);
    const cr = upstream.headers.get("content-range");
    if (cr) headers.set("content-range", cr);
    const ar = upstream.headers.get("accept-ranges");
    if (ar) headers.set("accept-ranges", ar);
    headers.set("cache-control", "public, max-age=86400");

    // 3) Изображение без range — буферизуем, кэшируем (если ≤ лимита) и отдаём.
    if (svc && key && upstream.ok && /^image\//i.test(ct)) {
      const buf = new Uint8Array(await upstream.arrayBuffer());
      if (buf.length && buf.length <= CACHE_MAX) {
        try { await svc.storage.from(BUCKET).upload(key, buf, { contentType: ct || "image/jpeg", upsert: true }); } catch { /* не критично */ }
      }
      maybeCleanup();
      return new Response(buf, { status: 200, headers });
    }

    // Прочее (range/большое/не картинка) — стримим как раньше, без кэша.
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e) {
    return new Response("proxy error: " + (e as Error).message, { status: 502, headers: cors });
  }
});
