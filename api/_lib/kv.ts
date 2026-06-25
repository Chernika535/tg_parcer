// Обёртка над Onreza KV. Если SDK недоступен (локальная разработка / тест),
// падаем на in-memory заглушку, чтобы код не ломался вне Onreza.
//
// ONREZA: подтверждено допущением — import { kv } from "@onreza/runtime/kv".
//         Сверить сигнатуры get/set (TTL в секундах) по docs.

type KVValue = string;

interface KVLike {
  get(key: string): Promise<KVValue | null>;
  set(key: string, value: KVValue, opts?: { ttl?: number }): Promise<void>;
  delete?(key: string): Promise<void>;
}

let backend: KVLike;

try {
  // Динамический импорт, чтобы отсутствие пакета вне Onreza не ломало сборку.
  // @ts-expect-error — пакет существует только в рантайме Onreza.
  const mod = await import("@onreza/runtime/kv");
  backend = mod.kv as KVLike;
} catch {
  console.warn("[kv] @onreza/runtime/kv недоступен — использую in-memory заглушку");
  const store = new Map<string, { value: string; expires: number }>();
  backend = {
    async get(key) {
      const e = store.get(key);
      if (!e) return null;
      if (e.expires && e.expires < Date.now()) {
        store.delete(key);
        return null;
      }
      return e.value;
    },
    async set(key, value, opts) {
      store.set(key, {
        value,
        expires: opts?.ttl ? Date.now() + opts.ttl * 1000 : 0,
      });
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

export const kv = {
  async getJSON<T>(key: string): Promise<T | null> {
    const raw = await backend.get(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  async setJSON(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await backend.set(key, JSON.stringify(value), { ttl: ttlSeconds });
  },
};
