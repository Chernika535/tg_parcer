import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Конфиг грузится в рантайме из /config.json, чтобы менять Supabase-проект и бота
// без пересборки (Onreza отдаёт статику как есть). anon-ключ публичен — это нормально.
export type AppConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  botUsername: string;
  mtBaseUrl?: string; // адрес MTProto-воркера на Deno Deploy (для закрытых каналов)
};

let _client: SupabaseClient | null = null;
let _config: AppConfig | null = null;

// Текущий access-token держим в памяти и обновляем по auth-событиям. Это нужно,
// чтобы вызовы функций НЕ дёргали getSession() (он без VPN зависает на refresh
// токена через заблокированный /auth/v1). Гость = null, и читаем публичное.
let _accessToken: string | null = null;
export function setAccessToken(t: string | null): void {
  _accessToken = t;
}
export function getAccessToken(): string | null {
  return _accessToken;
}

export async function initApp(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/config.json", { cache: "no-store" });
    if (!res.ok) return { ok: false, error: "не найден /config.json" };
    const cfg = (await res.json()) as AppConfig;
    if (!cfg.supabaseUrl || cfg.supabaseUrl.includes("YOUR-PROJECT")) {
      return { ok: false, error: "config.json не настроен (Supabase)" };
    }
    _config = cfg;
    _client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function supabase(): SupabaseClient {
  if (!_client) throw new Error("Supabase не инициализирован");
  return _client;
}

export function appConfig(): AppConfig {
  if (!_config) throw new Error("config не загружен");
  return _config;
}
