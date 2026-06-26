import { useEffect, useState } from "react";
import { tgStatus, tgSendCode, tgSignIn, tgDisconnect } from "../lib/data.ts";

// Подключение читающего аккаунта (MTProto) — только для админа.
export default function TgConnect() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [step, setStep] = useState<"phone" | "code" | "password">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function refresh() {
    setConnected(await tgStatus());
  }
  useEffect(() => {
    refresh();
  }, []);

  async function send() {
    setBusy(true);
    setMsg("");
    try {
      await tgSendCode(phone.trim());
      setStep("code");
      setMsg("Код отправлен в Telegram.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function signIn() {
    setBusy(true);
    setMsg("");
    try {
      const r = await tgSignIn(phone.trim(), code.trim(), step === "password" ? password : undefined);
      if (r.need_password) {
        setStep("password");
        setMsg("Включена 2FA — введите облачный пароль.");
        return;
      }
      setMsg("Аккаунт подключён ✓");
      setStep("phone");
      setCode("");
      setPassword("");
      refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("Отключить читающий аккаунт?")) return;
    await tgDisconnect();
    refresh();
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Чтение каналов без превью (MTProto)</h3>
      <p className="muted">
        Подключите отдельный Telegram-аккаунт, чтобы читать каналы с выключенным превью.
        Риск блокировки аккаунта — используйте запасной.
      </p>

      {connected === null && <p className="muted">Проверка…</p>}
      {connected === true && (
        <div className="row spread">
          <span className="badge ok">аккаунт подключён</span>
          <button className="btn danger sm" onClick={disconnect}>Отключить</button>
        </div>
      )}

      {connected === false && (
        <>
          {step === "phone" && (
            <div className="field">
              <label>Номер телефона (с +)</label>
              <div className="row">
                <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+79991234567" />
                <button className="btn sm" disabled={busy || !phone.trim()} onClick={send}>
                  {busy ? "…" : "Код"}
                </button>
              </div>
            </div>
          )}
          {(step === "code" || step === "password") && (
            <>
              <div className="field">
                <label>Код из Telegram</label>
                <input type="text" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="12345" />
              </div>
              {step === "password" && (
                <div className="field">
                  <label>Облачный пароль (2FA)</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              )}
              <button className="btn" disabled={busy || !code.trim()} onClick={signIn}>
                {busy ? "Вход…" : "Войти"}
              </button>
            </>
          )}
        </>
      )}

      {msg && <p className="muted" style={{ marginTop: 10 }}>{msg}</p>}
    </div>
  );
}
