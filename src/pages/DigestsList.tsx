import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Digest } from "../api.ts";
import { Loading, ErrorState, Empty, TopBar } from "../components/States.tsx";

function fmtTime(h: number, m: number) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default function DigestsList() {
  const [digests, setDigests] = useState<Digest[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const nav = useNavigate();

  async function load() {
    setErr("");
    try {
      setDigests(await api.listDigests());
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function toggle(d: Digest) {
    await api.updateDigest(d.id, { enabled: !d.enabled });
    load();
  }

  async function runNow(d: Digest) {
    setBusy(d.id);
    setToast("");
    try {
      const r = await api.runDigest(d.id);
      setToast(r.sent ? "Сводка отправлена ✓" : "Нет подходящих постов");
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(null);
      setTimeout(() => setToast(""), 4000);
    }
  }

  return (
    <>
      <TopBar title="Парсинги" />
      <div className="content">
        {toast && <div className="card" style={{ textAlign: "center" }}>{toast}</div>}
        {err && <ErrorState message={err} onRetry={load} />}
        {!digests && !err && <Loading />}
        {digests && digests.length === 0 && <Empty>Нет парсингов. Создайте первый.</Empty>}
        {digests?.map((d) => (
          <div key={d.id} className="card">
            <div className="row spread">
              <div className="grow" onClick={() => nav(`/digests/${d.id}`)}>
                <div style={{ fontWeight: 600 }}>{d.title}</div>
                <div className="muted">
                  🕑 {fmtTime(d.send_hour, d.send_minute)} · {d.channels.length} каналов ·{" "}
                  {d.keywords.length} ключей
                </div>
              </div>
              <label className="switch">
                <input type="checkbox" checked={d.enabled} onChange={() => toggle(d)} />
                <span />
              </label>
            </div>
            <div className="row" style={{ marginTop: 10, gap: 8 }}>
              <button className="btn sm" disabled={busy === d.id} onClick={() => runNow(d)}>
                {busy === d.id ? "…" : "▶ Запустить сейчас"}
              </button>
              <button className="btn secondary sm" onClick={() => nav(`/digests/${d.id}`)}>
                ✎ Изменить
              </button>
            </div>
          </div>
        ))}
      </div>
      <button className="fab" onClick={() => nav("/digests/new")}>
        + Парсинг
      </button>
    </>
  );
}
