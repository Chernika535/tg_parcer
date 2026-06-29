// Маячок: фронтенд проверяет, поднят ли прокси (на статике вернётся index.html).
export default defineEventHandler(() => ({ proxy: true }));
