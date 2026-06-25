import { sql } from "./_lib/db.ts";
import { currentUserId } from "./_lib/auth.ts";
import { json, error, readBody, normalizeUsername } from "./_lib/util.ts";

// ONREZA: сигнатура serverless-функции допущена как
//         export default function handler(req: Request): Response.
//         Сверить по docs (entrypoint / формат экспорта) и поправить при необходимости.
export default async function handler(req: Request): Promise<Response> {
  const userId = currentUserId();
  const url = new URL(req.url);

  try {
    if (req.method === "GET") {
      const rows = await sql<{ id: number; title: string; channel_count: number }[]>`
        SELECT f.id, f.title, COUNT(fc.id)::int AS channel_count
        FROM feeds f
        LEFT JOIN feed_channels fc ON fc.feed_id = f.id
        WHERE f.user_id = ${userId}
        GROUP BY f.id
        ORDER BY f.created_at DESC
      `;
      return json(
        rows.map((r) => ({ id: r.id, title: r.title, channelCount: r.channel_count })),
      );
    }

    if (req.method === "POST") {
      const { title } = await readBody<{ title?: string }>(req);
      if (!title || !title.trim()) return error("title обязателен");
      const [row] = await sql<{ id: number; title: string }[]>`
        INSERT INTO feeds (user_id, title) VALUES (${userId}, ${title.trim()})
        RETURNING id, title
      `;
      return json(row);
    }

    if (req.method === "PATCH") {
      const { id, title, channels } = await readBody<{
        id?: number;
        title?: string;
        channels?: string[];
      }>(req);
      if (!id) return error("id обязателен");

      const owned = await sql`SELECT id FROM feeds WHERE id = ${id} AND user_id = ${userId}`;
      if (owned.length === 0) return error("лента не найдена", 404);

      if (typeof title === "string" && title.trim()) {
        await sql`UPDATE feeds SET title = ${title.trim()} WHERE id = ${id}`;
      }

      if (Array.isArray(channels)) {
        const normalized: string[] = [];
        for (const c of channels) {
          const n = normalizeUsername(c);
          if (!n) return error(`невалидный канал: ${c}`);
          normalized.push(n);
        }
        const unique = [...new Set(normalized)];
        await sql`DELETE FROM feed_channels WHERE feed_id = ${id}`;
        if (unique.length > 0) {
          await sql`
            INSERT INTO feed_channels ${sql(
              unique.map((username) => ({ feed_id: id, username })),
            )}
            ON CONFLICT (feed_id, username) DO NOTHING
          `;
        }
      }
      return json({ ok: true });
    }

    if (req.method === "DELETE") {
      const id = Number(url.searchParams.get("id"));
      if (!id) return error("id обязателен");
      await sql`DELETE FROM feeds WHERE id = ${id} AND user_id = ${userId}`;
      return json({ ok: true });
    }

    return error("метод не поддерживается", 405);
  } catch (e) {
    console.error("[feeds]", e);
    return error("внутренняя ошибка", 500);
  }
}
