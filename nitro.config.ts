// Nitro-сервер для Onreza: отдаёт собранный фронтенд (dist) как статику и
// проксирует /sb/* в Supabase. Onreza нативно запускает Nitro (.output).
// Маршруты лежат в routes/ (дефолтная директория standalone-Nitro).
export default defineNitroConfig({
  compatibilityDate: "2026-01-01",
  publicAssets: [{ dir: "dist", baseURL: "/", maxAge: 60 }],
});
