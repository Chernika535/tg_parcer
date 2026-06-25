export type Post = {
  channel: string;
  msgId: number;
  postedAt: string; // ISO
  text: string;
  hasMedia: boolean;
  link: string;
};

// Нормализация username канала: убрать @, https://t.me/, t.me/, нижний регистр,
// оставить только [a-z0-9_]. Возвращает null если результат невалиден.
export function normalizeUsername(input: string): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^t\.me\//, "");
  s = s.replace(/^s\//, ""); // на случай вставки t.me/s/<name>
  s = s.replace(/^@/, "");
  // отрезать возможный путь/параметры
  s = s.split(/[/?#]/)[0];
  s = s.replace(/[^a-z0-9_]/g, "");
  if (s.length < 3 || s.length > 64) return null;
  return s;
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export async function readBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
