import postgres from "postgres";

// ONREZA: подтвердить по docs имя переменной строки подключения. Здесь DATABASE_URL.
//         Managed Postgres подключаем обычным клиентом postgres.js (postgres).

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // Не валим импорт целиком — функции, не требующие БД, должны работать,
  // но любой реальный запрос упадёт с понятной ошибкой.
  console.warn("[db] DATABASE_URL is not set");
}

declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

// Один пул на изолят функции (serverless переиспользует процесс между вызовами).
// max=3 — бережём лимит соединений у 0.25 CU базы.
export const sql =
  globalThis.__sql ??
  postgres(connectionString ?? "", {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__sql = sql;
}
