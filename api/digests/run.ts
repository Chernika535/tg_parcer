// POST /api/digests/run  { id } — ручной прогон сводки для теста.
import { sql } from "../_lib/db.ts";
import { currentUserId } from "../_lib/auth.ts";
import { json, error, readBody } from "../_lib/util.ts";
import { buildDigest, type Digest } from "../_lib/digest.ts";
import { sendMessage } from "../_lib/telegram.ts";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return error("метод не поддерживается", 405);
  const userId = currentUserId();

  try {
    const { id } = await readBody<{ id?: number }>(req);
    if (!id) return error("id обязателен");

    const [d] = await sql<Digest[]>`
      SELECT id, user_id, title, keywords, channels, send_hour, send_minute, enabled, last_sent_at
      FROM digests WHERE id = ${id} AND user_id = ${userId}
    `;
    if (!d) return error("парсинг не найден", 404);

    const [u] = await sql<{ tg_chat_id: number | null }[]>`
      SELECT tg_chat_id FROM users WHERE id = ${userId}
    `;
    if (!u?.tg_chat_id) return error("не подключён Telegram (chat_id пуст)", 400);

    const { text } = await buildDigest(d);
    if (!text) return json({ ok: true, sent: false });

    await sendMessage(Number(u.tg_chat_id), text);
    await sql`UPDATE digests SET last_sent_at = now() WHERE id = ${id}`;
    return json({ ok: true, sent: true });
  } catch (e) {
    console.error("[digests/run]", e);
    return error("внутренняя ошибка", 500);
  }
}
