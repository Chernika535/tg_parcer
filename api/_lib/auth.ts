// Однопользовательская версия: user_id берётся из APP_USER_ID, не из запроса.
export function currentUserId(): string {
  return process.env.APP_USER_ID || "local";
}

// Проверка секрета крона из заголовка X-Cron-Secret.
export function checkCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[auth] CRON_SECRET не задан — /api/cron отклоняет все запросы");
    return false;
  }
  return req.headers.get("x-cron-secret") === secret;
}
