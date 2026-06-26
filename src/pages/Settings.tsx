import { useEffect, useState } from "react";
import { api, type Settings as S } from "../api.ts";
import { Loading, ErrorState, TopBar } from "../components/States.tsx";

const TIMEZONES = [
  "Europe/Moscow",
  "Europe/Kaliningrad",
  "Europe/Samara",
  "Asia/Yekaterinburg",
  "Asia/Omsk",
  "Asia/Krasnoyarsk",
  "Asia/Irkutsk",
  "Asia/Vladivostok",
  "Europe/London",
  "UTC",
];

export default function Settings() {
  const [s, setS] = useState<S | null>(null);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [manualId, setManualId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setErr("");
    try {
      const data = await api.getSettings();
      setS(data);
      setManualId(data.tg_chat_id ? String(data.tg_chat_id) : "");
      setToken(data.bot_token || "");
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function flash(m: string) {
    setToast(m);
    setTimeout(() => setToast(""), 4000);
  }

  async function saveToken() {
    await api.updateSettings({ bot_token: token.trim() });
    flash("Токен сохранён");
    load();
  }

  async function connect() {
    if (!token.trim()) {
      flash("Сначала введите и сохраните токен бота");
      return;
    }
    await api.updateSettings({ bot_token: token.trim() });
    setBusy(true);
    try {
      const r = await api.telegramConnect();
      setManualId(String(r.chat_id));
      flash(`Подключено: ${r.chat_id}`);
      load();
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveManualId() {
    await api.updateSettings({ tg_chat_id: manualId ? Number(manualId) : null });
    flash("chat_id сохранён");
    load();
  }

  async function changeTz(tz: string) {
    await api.updateSettings({ timezone: tz });
    flash("Таймзона сохранена");
    load();
  }

  if (err && !s) return <ErrorState message={err} onRetry={load} />;
  if (!s) return <Loading />;

  return (
    <>
      <TopBar title="Настройки" />
      <div className="content">
        {toast && <div className="card" style={{ textAlign: "center" }}>{toast}</div>}

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Telegram</h3>
          <div className="field">
            <label>Токен бота (от @BotFather)</label>
            <div className="row">
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="123456:ABC-..."
              />
              <button className="btn sm" onClick={saveToken}>
                ОК
              </button>
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>
              Хранится только в этом браузере. Нужен для отправки сводок.
            </p>
          </div>
          <p className="muted">
            Текущий chat_id: <strong>{s.tg_chat_id ?? "не подключён"}</strong>
          </p>
          <ol className="muted" style={{ paddingLeft: 18 }}>
            <li>Откройте бота и отправьте <code>/start</code></li>
            <li>Нажмите «Определить chat_id»</li>
          </ol>
          <button className="btn" onClick={connect} disabled={busy}>
            {busy ? "Определяю…" : "Определить chat_id"}
          </button>

          <div className="field" style={{ marginTop: 16 }}>
            <label>Или введите chat_id вручную (через @userinfobot)</label>
            <div className="row">
              <input
                type="text"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="например 123456789"
              />
              <button className="btn sm" onClick={saveManualId}>
                ОК
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Таймзона</h3>
          <select value={s.timezone} onChange={(e) => changeTz(e.target.value)}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
          <p className="muted">Время отправки сводок указывается в этой зоне.</p>
        </div>
      </div>
    </>
  );
}
