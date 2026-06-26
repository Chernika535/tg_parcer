import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase.ts";

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
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(uid: string) {
    const { data } = await supabase().from("profiles").select("*").eq("id", uid).single();
    setProfile((data as Profile) ?? null);
  }

  useEffect(() => {
    supabase()
      .auth.getSession()
      .then(async ({ data }) => {
        setSession(data.session);
        if (data.session) await loadProfile(data.session.user.id);
        setLoading(false);
      });

    const { data: sub } = supabase().auth.onAuthStateChange(async (_e, s) => {
      setSession(s);
      if (s) await loadProfile(s.user.id);
      else setProfile(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function loginWithTelegram(u: TelegramUser) {
    const { data, error } = await supabase().functions.invoke("telegram-auth", { body: u });
    if (error) throw new Error(error.message);
    const { email, otp } = data as { email: string; otp: string };
    const { error: verr } = await supabase().auth.verifyOtp({ email, token: otp, type: "magiclink" });
    if (verr) throw new Error(verr.message);
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
