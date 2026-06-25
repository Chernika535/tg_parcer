import { getFeed } from "./_lib/feed.ts";
import { currentUserId } from "./_lib/auth.ts";
import { json, error } from "./_lib/util.ts";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return error("метод не поддерживается", 405);
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!id) return error("id обязателен");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);

  try {
    const result = await getFeed(id, currentUserId(), limit);
    if (!result) return error("лента не найдена", 404);
    return json(result);
  } catch (e) {
    console.error("[feed]", e);
    return error("внутренняя ошибка", 500);
  }
}
