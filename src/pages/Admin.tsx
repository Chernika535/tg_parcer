import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pendingFeeds, moderateFeed, type Feed } from "../lib/data.ts";
import { Loading, ErrorState, Empty, TopBar } from "../components/States.tsx";

export default function Admin() {
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const nav = useNavigate();

  async function load() {
    setErr("");
    try {
      setFeeds(await pendingFeeds());
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function decide(f: Feed, decision: "approved" | "rejected") {
    setBusy(f.id);
    try {
      let reason: string | undefined;
      if (decision === "rejected") {
        reason = prompt("Причина отклонения (необязательно)") || undefined;
      }
      await moderateFeed(f.id, decision, reason);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <TopBar title="Модерация публичных лент" />
      <div className="content">
        {err && <ErrorState message={err} onRetry={load} />}
        {!feeds && !err && <Loading />}
        {feeds && feeds.length === 0 && <Empty>Заявок на модерацию нет.</Empty>}
        {feeds?.map((f) => (
          <div key={f.id} className="card">
            <div className="row spread">
              <div className="grow" onClick={() => nav(`/feed/${f.id}`)}>
                <div style={{ fontWeight: 600 }}>{f.title}</div>
                <div className="muted">
                  {f.channels.length} каналов
                  {f.owner?.display_name ? ` · от ${f.owner.display_name}` : ""}
                </div>
              </div>
            </div>
            <div className="tags">
              {f.channels.map((c) => (
                <span key={c} className="tag">@{c}</span>
              ))}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button className="btn sm" disabled={busy === f.id} onClick={() => decide(f, "approved")}>
                ✓ Одобрить
              </button>
              <button
                className="btn danger sm"
                disabled={busy === f.id}
                onClick={() => decide(f, "rejected")}
              >
                ✕ Отклонить
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
