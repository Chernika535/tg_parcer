// Отдаём SPA для прямых переходов в редактор блога.
// Проверка прав администратора выполняется в React и Supabase RLS.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
export default defineEventHandler(async (event) => {
  setHeader(event, "content-type", "text/html; charset=utf-8");
  setHeader(event, "cache-control", "no-store");
  return await readFile(resolve(process.cwd(), "dist/index.html"), "utf8");
});
