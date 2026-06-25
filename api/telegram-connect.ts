// POST /api/telegram-connect — определяет chat_id через getUpdates после /start.
import { sql } from "./_lib/db.ts";
import { currentUserId } from "./_lib/auth.ts";
import { json, error } from "./_lib/util.ts";
import { getLastChatId } from "./_lib/telegram.ts";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return error("метод не поддерживается", 405);
  try {
    const chatId = await getLastChatId();
    if (chatId == null) {
      return error(
        "не нашёл сообщений. Откройте бота, отправьте /start и повторите. " +
          "Либо введите chat_id вручную (через @userinfobot).",
        404,
      );
    }
    await sql`UPDATE users SET tg_chat_id = ${chatId} WHERE id = ${currentUserId()}`;
    return json({ chat_id: chatId });
  } catch (e) {
    console.error("[telegram-connect]", e);
    return error("внутренняя ошибка", 500);
  }
}
