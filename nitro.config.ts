// Nitro-сервер для Onreza: отдаёт собранный фронтенд (dist) как статику и
// проксирует /sb/* в Supabase. Onreza нативно запускает Nitro (.output).
// Маршруты лежат в routes/ (дефолтная директория standalone-Nitro).
export default defineNitroConfig({
  compatibilityDate: "2026-01-01",
  // maxAge 0 — не кэшируем статику, чтобы новая версия применялась сразу
  // (ассеты с хэшами в имени всё равно безопасны). Избавляет от «старого кэша».
  publicAssets: [{ dir: "dist", baseURL: "/", maxAge: 0 }],
});
