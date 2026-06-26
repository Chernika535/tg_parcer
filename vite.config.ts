import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { copyFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Статический хостинг без серверного роутинга: чтобы прямой заход на /feeds,
// /digests и т.п. не давал 404, кладём SPA-фоллбэк — 404.html (копия index.html)
// и Netlify-style _redirects. Один из вариантов подхватит любой статик-хост.
function spaFallback(): Plugin {
  return {
    name: "spa-fallback",
    apply: "build",
    closeBundle() {
      const dist = resolve(__dirname, "dist");
      try {
        copyFileSync(resolve(dist, "index.html"), resolve(dist, "404.html"));
        writeFileSync(resolve(dist, "_redirects"), "/*    /index.html   200\n");
      } catch (e) {
        console.warn("[spa-fallback]", (e as Error).message);
      }
    },
  };
}

export default defineConfig({
  base: "/",
  plugins: [
    react(),
    spaFallback(),
    VitePWA({
      // Самоуничтожающийся SW: сносит ранее закэшированную (старую) версию
      // приложения и больше не кэширует app shell — обновления применяются сразу.
      // PWA-установку временно отключаем ради надёжных обновлений.
      selfDestroying: true,
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "Telegram Feed Aggregator",
        short_name: "TG Feeds",
        description: "Ленты публичных Telegram-каналов и сводки по ключевым словам",
        theme_color: "#0e1320",
        background_color: "#f5f7fa",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            // Статика приложения — CacheFirst.
            urlPattern: ({ request }) =>
              ["style", "script", "image", "font"].includes(request.destination),
            handler: "CacheFirst",
            options: { cacheName: "static-assets", expiration: { maxEntries: 60 } },
          },
        ],
      },
    }),
  ],
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
