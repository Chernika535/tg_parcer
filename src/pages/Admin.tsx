import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { allPublicFeeds, moderateFeed, deleteFeed, allChannels, adminAnalytics, type Feed, type AdminStats } from "../lib/data.ts";
import { Loading, ErrorState, Empty, TopBar } from "../components/States.tsx";

type Tab = "stats" | "pending" | "approved" | "rejected" | "channels";

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
  const isMod = tab === "pending" || tab === "approved" || tab === "rejected";
  const shown = (feeds ?? []).filter((f) => f.status === tab);

  return (
    <>
      <TopBar title="Модерация лент" />
      <div className="content">
        <div className="tabs-row">
          <button className={`seg ${tab === "stats" ? "on" : ""}`} onClick={() => setTab("stats")}>Аналитика</button>
          <button className={`seg ${tab === "pending" ? "on" : ""}`} onClick={() => setTab("pending")}>На модерации ({counts.pending})</button>
          <button className={`seg ${tab === "approved" ? "on" : ""}`} onClick={() => setTab("approved")}>Одобренные ({counts.approved})</button>
          <button className={`seg ${tab === "rejected" ? "on" : ""}`} onClick={() => setTab("rejected")}>Отклонённые ({counts.rejected})</button>
          <button className={`seg ${tab === "channels" ? "on" : ""}`} onClick={() => setTab("channels")}>Каналы</button>
        </div>

        {tab === "stats" && <AnalyticsPanel />}

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

        {isMod && err && <ErrorState message={err} onRetry={load} />}
        {isMod && !feeds && !err && <Loading />}
        {isMod && feeds && shown.length === 0 && <Empty>Здесь пусто.</Empty>}

        {isMod && shown.map((f) => (
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

const PERIODS: { label: string; days: number }[] = [
  { label: "7 дней", days: 7 },
  { label: "30 дней", days: 30 },
  { label: "90 дней", days: 90 },
  { label: "Всё время", days: 0 },
];

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-num">{value}</div>
      <div className="stat-lbl">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function RankList({ title, rows, kind }: {
  title: string;
  rows: { target: string; views: number; uniques: number; title?: string }[];
  kind: "feed" | "channel" | "post";
}) {
  const nav = useNavigate();
  const go = (t: string) => {
    if (kind === "feed") nav(`/feed/${t}`);
    else if (kind === "channel") nav(`/channel/${t}`);
    else window.open(t, "_blank");
  };
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>{title}</div>
      {rows.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Пока нет данных.</div>}
      {rows.map((r, i) => (
        <button key={r.target} className="rank-row" onClick={() => go(r.target)}>
          <span className="rank-pos">{i + 1}</span>
          <span className="rank-name">
            {kind === "feed" ? (r.title || `#${r.target}`) : kind === "channel" ? `@${r.target}` : r.target}
          </span>
          <span className="rank-val">{r.views} <span className="muted">/ {r.uniques} чел.</span></span>
        </button>
      ))}
    </div>
  );
}

function AnalyticsPanel() {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true); setErr("");
    adminAnalytics(days)
      .then(setStats)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [days]);

  const periodWord = days > 0 ? `за ${days} дн.` : "за всё время";

  return (
    <>
      <div className="tabs-row" style={{ marginBottom: 12 }}>
        {PERIODS.map((p) => (
          <button key={p.days} className={`seg ${days === p.days ? "on" : ""}`} onClick={() => setDays(p.days)}>{p.label}</button>
        ))}
      </div>

      {err && <ErrorState message={err} onRetry={() => setDays((d) => d)} />}
      {loading && !stats && <Loading />}

      {stats && (
        <>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Формат чисел: всего показов / уникальных посетителей ({periodWord}).
          </div>
          <div className="stat-grid">
            <Stat label="Заходов на сайт" value={stats.visitors.views} sub={`${stats.visitors.uniques} уник.`} />
            <Stat label="Просмотров лент" value={stats.feedViews.views} sub={`${stats.feedViews.uniques} уник.`} />
            <Stat label="Просмотров каналов" value={stats.channelViews.views} sub={`${stats.channelViews.uniques} уник.`} />
            <Stat label="Просмотров постов" value={stats.postViews.views} sub={`${stats.postViews.uniques} уник.`} />
            <Stat label="Новых пользователей" value={stats.newUsers} sub={`всего ${stats.totalUsers}`} />
            <Stat label="Новых авторов" value={stats.newAuthors} />
            <Stat label="Новых каналов" value={stats.newChannels} sub={`всего ${stats.totalChannels}`} />
            <Stat label="Постов опубликовано" value={stats.postsPublished} />
            <Stat label="Добавлений в избранное" value={stats.newFavorites} />
            <Stat label="Лайков поставлено" value={stats.newLikes} />
          </div>

          <RankList title="🔥 Популярные ленты" rows={stats.topFeeds} kind="feed" />
          <RankList title="🔥 Популярные каналы" rows={stats.topChannels} kind="channel" />
          <RankList title="🔥 Популярные посты" rows={stats.topPosts} kind="post" />
        </>
      )}
    </>
  );
}
