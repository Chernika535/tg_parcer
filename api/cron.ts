// POST /api/cron  header X-Cron-Secret — точка входа планировщика.
// ONREZA: если есть нативный cron — навесить его на этот же эндпоинт; секрет всё равно проверяем.
//         Если нет — внешний крон cron-job.org раз в 15 минут (см. README).
import { sql } from "./_lib/db.ts";
import { currentUserId, checkCronSecret } from "./_lib/auth.ts";
import { json, error } from "./_lib/util.ts";
import { buildDigest, type Digest } from "./_lib/digest.ts";
import { sendMessage } from "./_lib/telegram.ts";

const CRON_STEP_MINUTES = 15; // шаг внешнего крона; ширина окна срабатывания

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return error("метод не поддерживается", 405);
  if (!checkCronSecret(req)) return error("unauthorized", 401);

  const userId = currentUserId();
  let processed = 0;

  try {
    const [u] = await sql<{ tg_chat_id: number | null; timezone: string }[]>`
      SELECT tg_chat_id, timezone FROM users WHERE id = ${userId}
    `;
    if (!u?.tg_chat_id) {
      await cleanupOldPosts();
      return json({ processed: 0 });
    }

    const tz = u.timezone || "Europe/Moscow";
    const nowMin = localMinutesOfDay(new Date(), tz);
    const todayKey = localDateKey(new Date(), tz);

    const digests = await sql<Digest[]>`
      SELECT id, user_id, title, keywords, channels, send_hour, send_minute, enabled, last_sent_at
      FROM digests
      WHERE user_id = ${userId} AND enabled = true
    `;

    for (const d of digests) {
      const target = d.send_hour * 60 + d.send_minute;
      // окно [target, target + step)
      const inWindow = nowMin >= target && nowMin < target + CRON_STEP_MINUTES;
      if (!inWindow) continue;

      // защита от двойной отправки в один день
      if (d.last_sent_at && localDateKey(new Date(d.last_sent_at), tz) === todayKey) continue;

      const { text } = await buildDigest(d);
      if (text) {
        await sendMessage(Number(u.tg_chat_id), text);
      }
      // отмечаем отправку даже если текста нет — чтобы не пересчитывать окно повторно сегодня
      await sql`UPDATE digests SET last_sent_at = now() WHERE id = ${d.id}`;
      processed++;
    }

    await cleanupOldPosts();
    return json({ processed });
  } catch (e) {
    console.error("[cron]", e);
    return error("внутренняя ошибка", 500);
  }
}

async function cleanupOldPosts() {
  try {
    await sql`DELETE FROM posts WHERE posted_at < now() - interval '14 days'`;
  } catch (e) {
    console.warn("[cron] cleanup failed", (e as Error).message);
  }
}

function localParts(date: Date, tz: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return parts;
}

function localMinutesOfDay(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const h = Number(p.hour === "24" ? "0" : p.hour);
  return h * 60 + Number(p.minute);
}

function localDateKey(date: Date, tz: string): string {
  const p = localParts(date, tz);
  return `${p.year}-${p.month}-${p.day}`;
}
