// Node-сервер для Onreza: отдаёт собранный фронтенд (dist) И проксирует все
// запросы к Supabase под путём /sb/*. Смысл — Россия без VPN: браузер общается
// только с доменом Onreza (он доступен), а до Supabase ходит уже наш сервер
// (межсерверный трафик, который провайдер не режет).
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";

const PORT = process.env.PORT || 3000;
const DIST = join(process.cwd(), "dist");
const SUPABASE = process.env.SUPABASE_URL || "https://kklxahjnptrgnwcrpauh.supabase.co";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    req.on("error", () => resolve(undefined));
  });
}

async function proxy(req, res, url) {
  // Маячок: фронтенд проверяет, поднят ли прокси (на статике вернётся index.html).
  if (url.pathname === "/sb/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ proxy: true }));
    return;
  }
  const target = SUPABASE + url.pathname.slice(3) + url.search; // убираем префикс /sb
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const lk = k.toLowerCase();
    if (["host", "connection", "content-length", "accept-encoding"].includes(lk)) continue;
    headers[k] = v;
  }
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(target, { method: req.method, headers, body, signal: ctrl.signal }).finally(() => clearTimeout(timer));
    const out = {};
    r.headers.forEach((val, key) => {
      const lk = key.toLowerCase();
      if (["content-encoding", "transfer-encoding", "connection", "content-length"].includes(lk)) return;
      out[key] = val;
    });
    out["access-control-allow-origin"] = "*";
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, out);
    res.end(buf);
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "proxy: " + (e?.message || String(e)) }));
  }
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  let filePath = normalize(join(DIST, pathname));
  if (!filePath.startsWith(DIST)) filePath = join(DIST, "index.html"); // защита от traversal
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) throw new Error("dir");
    serveFile(res, filePath, 200);
  } catch {
    // SPA-фоллбэк: любой неизвестный путь → index.html
    serveFile(res, join(DIST, "index.html"), 200);
  }
}

function serveFile(res, filePath, status) {
  const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
  const headers = { "content-type": type };
  // index.html не кэшируем (чтобы не залипала старая версия), ассеты — надолго.
  if (filePath.endsWith("index.html")) headers["cache-control"] = "no-cache";
  else if (/\/assets\//.test(filePath)) headers["cache-control"] = "public, max-age=31536000, immutable";
  res.writeHead(status, headers);
  createReadStream(filePath).on("error", () => res.end()).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/sb" || url.pathname.startsWith("/sb/")) {
    return proxy(req, res, url);
  }
  return serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`ТелеФид сервер слушает :${PORT}, прокси /sb → ${SUPABASE}`);
});

// Заглушаем неожиданные ошибки, чтобы сервер не падал.
process.on("uncaughtException", (e) => console.error("uncaught", e));
process.on("unhandledRejection", (e) => console.error("unhandled", e));
