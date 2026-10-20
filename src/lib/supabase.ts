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

// Если на том же домене (Onreza) поднят наш прокси /sb → ходим через него
// (Россия без VPN). Иначе — напрямую в Supabase (как раньше, нужен VPN).
async function detectBase(directUrl: string): Promise<string> {
  try {
    const proxyBase = location.origin + "/sb";
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3500);
    const r = await fetch(proxyBase + "/health", { cache: "no-store", signal: ctrl.signal }).finally(() => clearTimeout(t));
    const j = (await r.json().catch(() => null)) as { proxy?: boolean } | null;
    if (j?.proxy) return proxyBase;
  } catch {
    /* прокси нет — идём напрямую */
  }
  return directUrl;
}

export async function initApp(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: "no-store" });
    if (!res.ok) return { ok: false, error: `не найден ${import.meta.env.BASE_URL}config.json` };
    const cfg = (await res.json()) as AppConfig;
    if (!cfg.supabaseUrl || cfg.supabaseUrl.includes("YOUR-PROJECT")) {
      return { ok: false, error: "config.json не настроен (Supabase)" };
    }
    cfg.supabaseUrl = await detectBase(cfg.supabaseUrl);
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
