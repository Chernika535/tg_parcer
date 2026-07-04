import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.tsx";
import { initApp } from "./lib/supabase.ts";
import { AuthProvider } from "./lib/auth.tsx";
import { applyTheme, getTheme } from "./lib/theme.ts";
import "./styles/global.css";

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
      <HashRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </HashRouter>
    </React.StrictMode>,
  );
});
