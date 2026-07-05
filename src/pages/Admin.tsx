import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { allPublicFeeds, moderateFeed, deleteFeed, allChannels, type Feed } from "../lib/data.ts";
import { Loading, ErrorState, Empty, TopBar } from "../components/States.tsx";

type Tab = "pending" | "approved" | "rejected" | "channels";

export default function Admin() {
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [channels, setChannels] = useState<{ username: string; feeds: number }[] | null>(null);
  const [chQuery, setChQuery] = useState("");
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
  useEffect(() => {
    if (tab === "channels" && !channels) allChannels().then(setChannels).catch((e) => setErr(e.message));
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <button className={`seg ${tab === "channels" ? "on" : ""}`} onClick={() => setTab("channels")}>Каналы</button>
        </div>

        {/* Все каналы — только для админа, со статистикой на странице канала */}
        {tab === "channels" && (
          <>
            <div className="field">
              <input type="text" placeholder="Поиск канала…" value={chQuery} onChange={(e) => setChQuery(e.target.value)} />
            </div>
            {!channels && !err && <Loading />}
            {channels && channels.length === 0 && <Empty>Каналов пока нет.</Empty>}
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              Всего каналов: {channels?.length ?? 0}. Откройте канал, чтобы увидеть лайки, избранное и в скольких личных подборках он есть.
            </div>
            {(channels ?? [])
              .filter((c) => !chQuery.trim() || c.username.includes(chQuery.trim().toLowerCase()))
              .map((c) => (
                <button key={c.username} className="card row spread" style={{ width: "100%", textAlign: "left", cursor: "pointer" }} onClick={() => nav(`/channel/${c.username}`)}>
                  <span style={{ fontWeight: 700 }}>@{c.username}</span>
                  <span className="muted" style={{ fontSize: 12 }}>в {c.feeds} лентах →</span>
                </button>
              ))}
          </>
        )}

        {tab !== "channels" && err && <ErrorState message={err} onRetry={load} />}
        {tab !== "channels" && !feeds && !err && <Loading />}
        {tab !== "channels" && feeds && shown.length === 0 && <Empty>Здесь пусто.</Empty>}

        {tab !== "channels" && shown.map((f) => (
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
