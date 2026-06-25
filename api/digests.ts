import { sql } from "./_lib/db.ts";
import { currentUserId } from "./_lib/auth.ts";
import { json, error, readBody, normalizeUsername } from "./_lib/util.ts";

type DigestInput = {
  id?: number;
  title?: string;
  keywords?: string[];
  channels?: string[];
  send_hour?: number;
  send_minute?: number;
  enabled?: boolean;
};

function normChannels(channels: unknown): string[] | { err: string } {
  if (!Array.isArray(channels)) return [];
  const out: string[] = [];
  for (const c of channels) {
    const n = normalizeUsername(String(c));
    if (!n) return { err: `невалидный канал: ${c}` };
    out.push(n);
  }
  return [...new Set(out)];
}

function cleanKeywords(k: unknown): string[] {
  if (!Array.isArray(k)) return [];
  return [...new Set(k.map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
}

export default async function handler(req: Request): Promise<Response> {
  const userId = currentUserId();
  const url = new URL(req.url);

  try {
    if (req.method === "GET") {
      const rows = await sql`
        SELECT id, title, keywords, channels, send_hour, send_minute, enabled, last_sent_at
        FROM digests WHERE user_id = ${userId} ORDER BY created_at DESC
      `;
      return json(rows);
    }

    if (req.method === "POST") {
      const b = await readBody<DigestInput>(req);
      if (!b.title || !b.title.trim()) return error("title обязателен");
      const ch = normChannels(b.channels);
      if ("err" in ch) return error(ch.err);
      const hour = clampInt(b.send_hour, 0, 23);
      const minute = clampInt(b.send_minute, 0, 59, 0);
      if (hour === null) return error("send_hour 0..23 обязателен");

      const [row] = await sql`
        INSERT INTO digests (user_id, title, keywords, channels, send_hour, send_minute, enabled)
        VALUES (${userId}, ${b.title.trim()}, ${cleanKeywords(b.keywords)},
                ${ch}, ${hour}, ${minute}, ${b.enabled ?? true})
        RETURNING id, title, keywords, channels, send_hour, send_minute, enabled, last_sent_at
      `;
      return json(row);
    }

    if (req.method === "PATCH") {
      const b = await readBody<DigestInput>(req);
      if (!b.id) return error("id обязателен");
      const owned = await sql`SELECT id FROM digests WHERE id = ${b.id} AND user_id = ${userId}`;
      if (owned.length === 0) return error("парсинг не найден", 404);

      if (typeof b.title === "string" && b.title.trim())
        await sql`UPDATE digests SET title = ${b.title.trim()} WHERE id = ${b.id}`;
      if (b.keywords !== undefined)
        await sql`UPDATE digests SET keywords = ${cleanKeywords(b.keywords)} WHERE id = ${b.id}`;
      if (b.channels !== undefined) {
        const ch = normChannels(b.channels);
        if ("err" in ch) return error(ch.err);
        await sql`UPDATE digests SET channels = ${ch} WHERE id = ${b.id}`;
      }
      if (b.send_hour !== undefined) {
        const h = clampInt(b.send_hour, 0, 23);
        if (h === null) return error("send_hour 0..23");
        await sql`UPDATE digests SET send_hour = ${h} WHERE id = ${b.id}`;
      }
      if (b.send_minute !== undefined) {
        const m = clampInt(b.send_minute, 0, 59, 0)!;
        await sql`UPDATE digests SET send_minute = ${m} WHERE id = ${b.id}`;
      }
      if (b.enabled !== undefined)
        await sql`UPDATE digests SET enabled = ${b.enabled} WHERE id = ${b.id}`;

      return json({ ok: true });
    }

    if (req.method === "DELETE") {
      const id = Number(url.searchParams.get("id"));
      if (!id) return error("id обязателен");
      await sql`DELETE FROM digests WHERE id = ${id} AND user_id = ${userId}`;
      return json({ ok: true });
    }

    return error("метод не поддерживается", 405);
  } catch (e) {
    console.error("[digests]", e);
    return error("внутренняя ошибка", 500);
  }
}

function clampInt(v: unknown, min: number, max: number, dflt?: number): number | null {
  if (v === undefined || v === null || v === "") return dflt ?? null;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) return dflt ?? null;
  return n;
}
