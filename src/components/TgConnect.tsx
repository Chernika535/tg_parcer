import { useEffect, useRef, useState } from "react";
import { tgStatus, tgDisconnect, tgSetSession } from "../lib/data.ts";

// Публичные api_id/api_hash официального клиента (по запросу пользователя).
const API_ID = 2040;
const API_HASH = "b18441a1ff607e10a989891a5462e627";

// MTKruto умеет работать в браузере. Грузим его в рантайме (без сборки),
// пробуя несколько источников.
const MT_URLS = [
  "https://esm.sh/jsr/@mtkruto/mtkruto",
  "https://esm.sh/mtkruto",
  "https://cdn.jsdelivr.net/npm/mtkruto/+esm",
];
// deno-lint-ignore no-explicit-any
async function loadMtkruto(): Promise<any> {
  let lastErr = "";
  for (const url of MT_URLS) {
    try {
      const mod = await import(/* @vite-ignore */ url);
      if (mod?.Client) return mod;
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  throw new Error("не удалось загрузить MTKruto: " + lastErr);
}

export default function TgConnect() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<"idle" | "code" | "password" | "working">("idle");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const codeResolve = useRef<((v: string) => void) | null>(null);
  const passResolve = useRef<((v: string) => void) | null>(null);

  async function refresh() {
    setConnected(await tgStatus());
  }
  useEffect(() => {
    refresh();
  }, []);

  async function startLogin() {
    if (!phone.trim()) {
      setMsg("Введите номер");
      return;
    }
    setMsg("Подключаюсь к Telegram…");
    setPhase("working");
    try {
      const { Client, StorageMemory } = await loadMtkruto();
      const client = new Client({ storage: new StorageMemory(), apiId: API_ID, apiHash: API_HASH });
      await client.start({
        phone: () => phone.trim(),
        code: () =>
          new Promise<string>((res) => {
            codeResolve.current = res;
            setPhase("code");
            setMsg("Код отправлен — введите его.");
          }),
        password: () =>
          new Promise<string>((res) => {
            passResolve.current = res;
            setPhase("password");
            setMsg("Включена 2FA — введите облачный пароль.");
          }),
      });
      const session = await client.exportAuthString();
      await tgSetSession(session);
      try {
        await client.disconnect();
      } catch {
        /* ignore */
      }
      setPhase("idle");
      setMsg("Аккаунт подключён ✓");
      setCode("");
      setPassword("");
      refresh();
    } catch (e) {
      setPhase("idle");
      setMsg("Ошибка: " + (e as Error).message);
    }
  }

  function submitCode() {
    if (!code.trim() || !codeResolve.current) return;
    setPhase("working");
    setMsg("Проверяю код…");
    codeResolve.current(code.trim());
  }
  function submitPassword() {
    if (!password.trim() || !passResolve.current) return;
    setPhase("working");
    setMsg("Проверяю пароль…");
    passResolve.current(password.trim());
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
        Вход выполняется прямо здесь, в браузере. Используйте отдельный (запасной) аккаунт —
        есть риск блокировки. Подключается один раз, читать смогут все.
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
          <div className="field">
            <label>Номер телефона (с +)</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+79991234567"
              disabled={phase !== "idle"}
            />
          </div>

          {phase === "idle" && (
            <button className="btn" onClick={startLogin}>Получить код</button>
          )}

          {phase === "code" && (
            <div className="field">
              <label>Код из Telegram</label>
              <div className="row">
                <input type="text" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="12345" />
                <button className="btn sm" onClick={submitCode}>ОК</button>
              </div>
            </div>
          )}

          {phase === "password" && (
            <div className="field">
              <label>Облачный пароль (2FA)</label>
              <div className="row">
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button className="btn sm" onClick={submitPassword}>ОК</button>
              </div>
            </div>
          )}

          {phase === "working" && <p className="muted">Подождите…</p>}
        </>
      )}

      {msg && <p className="muted" style={{ marginTop: 10 }}>{msg}</p>}
    </div>
  );
}
