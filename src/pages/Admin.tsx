import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { allPublicFeeds, moderateFeed, deleteFeed, type Feed } from "../lib/data.ts";
import { Loading, ErrorState, Empty, TopBar } from "../components/States.tsx";

type Tab = "pending" | "approved" | "rejected";

export default function Admin() {
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("pending");
  const nav = useNavigate();

  async function load() {
    setErr("");
    try {
      setFeeds(await allPublicFeeds());
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => { load(); }, []);

  async function decide(f: Feed, decision: "approved" | "rejected") {
    setBusy(f.id);
    try {
      let reason: string | undefined;
      if (decision === "rejected") reason = prompt("Причина отклонения (необязательно)") || undefined;
      await moderateFeed(f.id, decision, reason);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function remove(f: Feed) {
    if (!confirm(`Удалить ленту «${f.title}»?`)) return;
    setBusy(f.id);
    try { await deleteFeed(f.id); await load(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  const counts = useMemo(() => ({
    pending: (feeds ?? []).filter((f) => f.status === "pending").length,
    approved: (feeds ?? []).filter((f) => f.status === "approved").length,
    rejected: (feeds ?? []).filter((f) => f.status === "rejected").length,
  }), [feeds]);
  const shown = (feeds ?? []).filter((f) => f.status === tab);

  return (
    <>
      <TopBar title="Модерация лент" />
      <div className="content">
        <div className="tabs-row">
          <button className={`seg ${tab === "pending" ? "on" : ""}`} onClick={() => setTab("pending")}>На модерации ({counts.pending})</button>
          <button className={`seg ${tab === "approved" ? "on" : ""}`} onClick={() => setTab("approved")}>Одобренные ({counts.approved})</button>
          <button className={`seg ${tab === "rejected" ? "on" : ""}`} onClick={() => setTab("rejected")}>Отклонённые ({counts.rejected})</button>
        </div>

        {err && <ErrorState message={err} onRetry={load} />}
        {!feeds && !err && <Loading />}
        {feeds && shown.length === 0 && <Empty>Здесь пусто.</Empty>}

        {shown.map((f) => (
          <div key={f.id} className="card">
            <div className="grow" onClick={() => nav(`/feed/${f.id}`)}>
              <div style={{ fontWeight: 700 }}>{f.title}</div>
              <div className="muted">
                {f.channels.length} каналов
                {f.owner?.display_name ? ` · от ${f.owner.display_name}` : ""}
              </div>
            </div>
            {f.status === "rejected" && f.reject_reason && (
              <div className="muted" style={{ marginTop: 4 }}>Причина: {f.reject_reason}</div>
            )}
            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {tab !== "approved" && (
                <button className="btn sm" disabled={busy === f.id} onClick={() => decide(f, "approved")}>✓ Одобрить</button>
              )}
              {tab !== "rejected" && (
                <button className="btn danger sm" disabled={busy === f.id} onClick={() => decide(f, "rejected")}>✕ Отклонить</button>
              )}
              <button className="btn secondary sm" onClick={() => nav(`/my/${f.id}/edit`)}>✎ Редактировать</button>
              <button className="btn ghost sm" disabled={busy === f.id} onClick={() => remove(f)}>🗑 Удалить</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
