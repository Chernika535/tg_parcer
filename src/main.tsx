import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { initApp } from "./lib/supabase.ts";
import { AuthProvider } from "./lib/auth.tsx";
import { applyTheme, getTheme } from "./lib/theme.ts";
import "./styles/global.css";

// Все домены, кроме основного и Cloudflare Pages, уводим на polistay.online. Делаем это в браузере
// (location.hostname надёжен), а не на сервере — Onreza проксирует кастомные
// домены и передаёт серверу внутренний host, из-за чего серверный редирект ломался.
(() => {
  const PRIMARY = "polistay.online";
  const h = location.hostname;
  const local = h === "localhost" || h.startsWith("127.") || h.startsWith("192.168.") || h.endsWith(".local");
  const cloudflarePreview = h === "polistay.pages.dev" || h.endsWith(".polistay.pages.dev");
  // Страницу восстановления НЕ редиректим: кэш лент лежит в localStorage того
  // домена, где ленту открывали (localStorage у каждого домена свой). Так можно
  // зайти на старый домен и достать из него данные.
  const recover = location.pathname.includes("/recover") || location.hash.includes("recover") || location.search.includes("nored");
  if (h && h !== PRIMARY && !local && !cloudflarePreview && !recover) {
    location.replace("https://" + PRIMARY + location.pathname + location.search + location.hash);
  }
})();

// Перенос старых hash-маршрутов без потери query-параметров.
// Не меняем URL для служебных hash-фрагментов (например, токенов авторизации).
if (location.hash.startsWith("#/")) {
  const oldRoute = location.hash.slice(1);
  const [pathname, hashQuery = ""] = oldRoute.split("?");
  if (pathname.startsWith("/") && !pathname.startsWith("//")) {
    const params = new URLSearchParams(location.search);
    new URLSearchParams(hashQuery).forEach((value, key) => params.append(key, value));
    location.replace(pathname + (params.size ? "?" + params : ""));
  }
}

// Тема — до первого рендера, чтобы не мигало светлым.
applyTheme(getTheme());

// Жёстко вычищаем старые service worker'ы и их кэш. Раньше SW кэшировал JS
// «навсегда» (CacheFirst), и телефон крутил устаревший код, который ходил на
// заблокированный в РФ поддомен functions.* — отсюда вечное «Читаю каналы…».
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
}
if (typeof caches !== "undefined") {
  caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
}

const root = ReactDOM.createRoot(document.getElementById("root")!);

initApp().then((res) => {
  if (!res.ok) {
    root.render(
      <div className="app">
        <div className="state">
          <p style={{ color: "var(--accent-2)" }}>⚠ Приложение не настроено</p>
          <p className="muted">{res.error}</p>
          <p className="muted">Заполните <code>config.json</code> (см. SETUP.md).</p>
        </div>
      </div>,
    );
    return;
  }
  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>,
  );
});
