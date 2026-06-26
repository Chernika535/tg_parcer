import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { initApp } from "./lib/supabase.ts";
import { AuthProvider } from "./lib/auth.tsx";
import "./styles/global.css";

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
