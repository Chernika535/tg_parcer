import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, setAccessToken } from "./supabase.ts";
import { invokeFn, getMyProfile } from "./data.ts";

export type Profile = {
  id: string;
  telegram_id: number | null;
  username: string | null;
  display_name: string | null;
  photo_url: string | null;
  role: "user" | "admin";
};

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  loginWithTelegram: (u: TelegramUser) => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string) => Promise<{ needConfirm: boolean }>;
  updateCredentials: (fields: { email?: string; password?: string }) => Promise<{ emailConfirm: boolean }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(_uid: string) {
    // Через функцию (по JWT), а не supabase-js REST — стабильнее через прокси.
    try {
      const p = await getMyProfile();
      setProfile((p as Profile) ?? null);
    } catch {
      setProfile(null);
    }
  }

  useEffect(() => {
    // Не блокируем загрузку приложения дольше 2.5с. В России /auth/v1 Supabase
    // часто заблокирован без VPN, и обновление токена «зависает» — тогда просто
    // показываем приложение как гостю, а сессия подхватится позже, если придёт.
    const timer = setTimeout(() => setLoading(false), 2500);

    supabase()
      .auth.getSession()
      .then(({ data }) => {
        setSession(data.session);
        setAccessToken(data.session?.access_token ?? null);
        setLoading(false);
        clearTimeout(timer);
        if (data.session) loadProfile(data.session.user.id); // не блокируем
      })
      .catch(() => {
        setLoading(false);
        clearTimeout(timer);
      });

    const { data: sub } = supabase().auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setAccessToken(s?.access_token ?? null);
      if (s) loadProfile(s.user.id);
      else setProfile(null);
    });
    return () => {
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  async function loginWithTelegram(u: TelegramUser) {
    // Вызываем по основному домену (см. invokeFn) — поддомен functions.* в РФ блокируется.
    const data = await invokeFn("telegram-auth", u as unknown as Record<string, unknown>);
    const { token_hash } = data as { token_hash?: string };
    if (!token_hash) throw new Error("сервер не вернул token_hash");
    const { error: verr } = await supabase().auth.verifyOtp({ token_hash, type: "magiclink" });
    if (verr) throw new Error(verr.message);
  }

  async function signInEmail(email: string, password: string) {
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message);
  }

  async function signUpEmail(email: string, password: string): Promise<{ needConfirm: boolean }> {
    const { data, error } = await supabase().auth.signUp({
      email: email.trim(),
      password,
      // Ссылка-подтверждение должна вести на наш домен, а не на localhost.
      options: { emailRedirectTo: location.origin },
    });
    if (error) throw new Error(error.message);
    // Если в проекте включено подтверждение почты — сессии сразу не будет.
    return { needConfirm: !data.session };
  }

  // Привязка/смена e-mail и/или пароля у текущего аккаунта (в т.ч. для вошедших
  // через Telegram — так можно добавить второй способ входа).
  async function updateCredentials(fields: { email?: string; password?: string }): Promise<{ emailConfirm: boolean }> {
    // Применяем через edge-функцию под service-role — сразу, без письма-подтверждения
    // (client-side updateUser отправляет почту в «ожидание», а SMTP часто не доходит).
    const res = (await invokeFn("myfeeds", {
      action: "set_credentials",
      input: { email: fields.email?.trim() || undefined, password: fields.password || undefined },
    })) as { ok?: boolean; email?: string; error?: string };
    if (res.error) throw new Error(res.error);
    // Обновляем локальную сессию, чтобы показать новый e-mail сразу.
    try { await supabase().auth.refreshSession(); } catch { /* не критично */ }
    return { emailConfirm: false };
  }

  async function signOut() {
    await supabase().auth.signOut();
  }

  async function refreshProfile() {
    if (session) await loadProfile(session.user.id);
  }

  return (
    <Ctx.Provider
      value={{
        session,
        profile,
        loading,
        isAdmin: profile?.role === "admin",
        loginWithTelegram,
        signInEmail,
        signUpEmail,
        updateCredentials,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth вне AuthProvider");
  return v;
}
