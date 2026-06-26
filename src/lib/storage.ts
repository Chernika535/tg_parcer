// Локальное хранилище данных приложения (без бэкенда). Всё в localStorage.

export type Feed = { id: number; title: string; channels: string[] };
export type Digest = {
  id: number;
  title: string;
  keywords: string[];
  channels: string[];
  send_hour: number;
  send_minute: number;
  enabled: boolean;
  last_sent_at: string | null;
};
export type Settings = {
  tg_chat_id: number | null;
  timezone: string;
  bot_token: string;
};

const K_FEEDS = "tgfeed:feeds";
const K_DIGESTS = "tgfeed:digests";
const K_SETTINGS = "tgfeed:settings";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function nextId(items: { id: number }[]): number {
  return items.reduce((m, x) => Math.max(m, x.id), 0) + 1;
}

// Нормализация username канала: @name / t.me/name / ссылка -> name.
export function normalizeUsername(input: string): string | null {
  let s = input.trim().toLowerCase();
  s = s
    .replace(/^https?:\/\//, "")
    .replace(/^t\.me\//, "")
    .replace(/^s\//, "")
    .replace(/^@/, "");
  s = s.split(/[/?#]/)[0].replace(/[^a-z0-9_]/g, "");
  return s.length >= 3 && s.length <= 64 ? s : null;
}

function normChannels(channels: string[]): string[] {
  const out: string[] = [];
  for (const c of channels) {
    const n = normalizeUsername(c);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

// ---- Feeds ----
export const feeds = {
  all: () => read<Feed[]>(K_FEEDS, []),
  get: (id: number) => feeds.all().find((f) => f.id === id) || null,
  create(title: string): Feed {
    const list = feeds.all();
    const f: Feed = { id: nextId(list), title: title.trim(), channels: [] };
    write(K_FEEDS, [f, ...list]);
    return f;
  },
  update(id: number, fields: { title?: string; channels?: string[] }) {
    const list = feeds.all().map((f) =>
      f.id === id
        ? {
            ...f,
            title: fields.title?.trim() || f.title,
            channels: fields.channels ? normChannels(fields.channels) : f.channels,
          }
        : f,
    );
    write(K_FEEDS, list);
  },
  remove(id: number) {
    write(
      K_FEEDS,
      feeds.all().filter((f) => f.id !== id),
    );
  },
};

// ---- Digests ----
export const digests = {
  all: () => read<Digest[]>(K_DIGESTS, []),
  get: (id: number) => digests.all().find((d) => d.id === id) || null,
  create(input: Partial<Digest>): Digest {
    const list = digests.all();
    const d: Digest = {
      id: nextId(list),
      title: (input.title || "").trim(),
      keywords: (input.keywords || []).map((k) => k.toLowerCase().trim()).filter(Boolean),
      channels: normChannels(input.channels || []),
      send_hour: input.send_hour ?? 9,
      send_minute: input.send_minute ?? 0,
      enabled: input.enabled ?? true,
      last_sent_at: null,
    };
    write(K_DIGESTS, [d, ...list]);
    return d;
  },
  update(id: number, fields: Partial<Digest>) {
    const list = digests.all().map((d) =>
      d.id === id
        ? {
            ...d,
            ...fields,
            keywords: fields.keywords
              ? fields.keywords.map((k) => k.toLowerCase().trim()).filter(Boolean)
              : d.keywords,
            channels: fields.channels ? normChannels(fields.channels) : d.channels,
          }
        : d,
    );
    write(K_DIGESTS, list);
  },
  remove(id: number) {
    write(
      K_DIGESTS,
      digests.all().filter((d) => d.id !== id),
    );
  },
};

// ---- Settings ----
const DEFAULT_SETTINGS: Settings = {
  tg_chat_id: null,
  timezone: "Europe/Moscow",
  bot_token: "",
};
export const settings = {
  get: () => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(K_SETTINGS, {}) }),
  update(fields: Partial<Settings>) {
    write(K_SETTINGS, { ...settings.get(), ...fields });
  },
};
