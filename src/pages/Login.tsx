import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, type TelegramUser } from "../lib/auth.tsx";
import { TopBar, ErrorState } from "../components/States.tsx";
import TelegramLogin from "../components/TelegramLogin.tsx";

export default function Login() {
  const { loginWithTelegram, session } = useAuth();
  const nav = useNavigate();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const onAuth = useCallback(
    async (u: TelegramUser) => {
      setBusy(true);
      setErr("");
      try {
        await loginWithTelegram(u);
        nav("/my", { replace: true });
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [loginWithTelegram, nav],
  );

  if (session) {
    nav("/my", { replace: true });
    return null;
  }

  return (
    <>
      <TopBar title="Вход" />
      <div className="content">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Войти через Telegram</h3>
          <p className="muted">
            Чтобы создавать свои ленты (приватные и общедоступные) и отправлять заявки на
            публикацию, войдите через Telegram. Общедоступные ленты можно смотреть и без входа.
          </p>
          {busy ? <p>Входим…</p> : <TelegramLogin onAuth={onAuth} />}
          {err && <ErrorState message={err} />}
        </div>
      </div>
    </>
  );
}
