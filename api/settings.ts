import { sql } from "./_lib/db.ts";
import { currentUserId } from "./_lib/auth.ts";
import { json, error, readBody } from "./_lib/util.ts";

export default async function handler(req: Request): Promise<Response> {
  const userId = currentUserId();
  try {
    if (req.method === "GET") {
      const [u] = await sql<{ tg_chat_id: number | null; timezone: string }[]>`
        SELECT tg_chat_id, timezone FROM users WHERE id = ${userId}
      `;
      return json({ tg_chat_id: u?.tg_chat_id ?? null, timezone: u?.timezone ?? "Europe/Moscow" });
    }

    if (req.method === "PATCH") {
      const { tg_chat_id, timezone } = await readBody<{
        tg_chat_id?: number | string | null;
        timezone?: string;
      }>(req);

      if (tg_chat_id !== undefined) {
        const v = tg_chat_id === null || tg_chat_id === "" ? null : Number(tg_chat_id);
        if (v !== null && !Number.isFinite(v)) return error("tg_chat_id должен быть числом");
        await sql`UPDATE users SET tg_chat_id = ${v} WHERE id = ${userId}`;
      }
      if (typeof timezone === "string" && timezone.trim()) {
        await sql`UPDATE users SET timezone = ${timezone.trim()} WHERE id = ${userId}`;
      }
      return json({ ok: true });
    }

    return error("метод не поддерживается", 405);
  } catch (e) {
    console.error("[settings]", e);
    return error("внутренняя ошибка", 500);
  }
}
