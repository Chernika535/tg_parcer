import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, type TelegramUser } from "../lib/auth.tsx";
import { TopBar, ErrorState } from "../components/States.tsx";
import TelegramLogin from "../components/TelegramLogin.tsx";

export default function Login() {
  const { loginWithTelegram, signInEmail, signUpEmail, session } = useAuth();
  const nav = useNavigate();
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onAuth = useCallback(
    async (u: TelegramUser) => {
      setBusy(true);
      setErr("");
      try {
        await loginWithTelegram(u);
        nav("/feeds", { replace: true });
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [loginWithTelegram, nav],
  );

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setMsg("");
    if (!email.trim() || password.length < 6) {
      setErr("Введите e-mail и пароль не короче 6 символов");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        await signInEmail(email, password);
        nav("/feeds", { replace: true });
      } else {
        const { needConfirm } = await signUpEmail(email, password);
        if (needConfirm) setMsg("Аккаунт создан. Подтвердите e-mail по ссылке из письма, затем войдите.");
        else nav("/feeds", { replace: true });
      }
    } catch (e) {
      const m = (e as Error).message || "";
      if (/not confirmed/i.test(m)) setErr("E-mail не подтверждён. Подтвердите его по ссылке из письма, либо попросите администратора подтвердить аккаунт.");
      else if (/invalid login credentials/i.test(m)) setErr("Неверный e-mail или пароль.");
      else if (/already registered|already exists/i.test(m)) setErr("Такой e-mail уже зарегистрирован — войдите.");
      else setErr(m);
    } finally {
      setBusy(false);
    }
  }

  if (session) {
    nav("/feeds", { replace: true });
    return null;
  }

  return (
    <>
      <TopBar title="Вход" />
      <div className="content">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Вход по e-mail</h3>
          <form onSubmit={submitEmail}>
            <div className="field">
              <label>E-mail</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
            </div>
            <div className="field">
              <label>Пароль</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="не короче 6 символов" autoComplete={mode === "signin" ? "current-password" : "new-password"} />
            </div>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "…" : mode === "signin" ? "Войти" : "Зарегистрироваться"}
            </button>
          </form>
          <button
            className="btn ghost sm"
            style={{ marginTop: 8 }}
            onClick={() => { setMode((m) => (m === "signin" ? "signup" : "signin")); setErr(""); setMsg(""); }}
          >
            {mode === "signin" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
          </button>
          {msg && <p className="muted" style={{ marginTop: 10 }}>{msg}</p>}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Или через Telegram</h3>
          <p className="muted">
            Виджет Telegram может не открываться без VPN (скрипт грузится с telegram.org).
            Если не появился — используйте вход по e-mail выше.
          </p>
          {busy ? <p>Входим…</p> : <TelegramLogin onAuth={onAuth} />}
        </div>

        {err && <ErrorState message={err} />}
      </div>
    </>
  );
}
