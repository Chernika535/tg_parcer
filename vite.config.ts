import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// ONREZA: output dir assumed "dist" (Vite default). Build command "npm run build".
//         Adjust in onreza.json if docs require a different output dir.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
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
        runtimeCaching: [
          {
            // App static — CacheFirst.
            urlPattern: ({ request }) =>
              ["style", "script", "image", "font"].includes(request.destination),
            handler: "CacheFirst",
            options: { cacheName: "static-assets", expiration: { maxEntries: 60 } },
          },
          {
            // /api/* — NetworkFirst so feeds open offline from the last response.
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
            },
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
