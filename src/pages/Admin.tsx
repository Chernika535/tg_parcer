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
        <div className="field" style={{ marginBottom: 8 }}>
          <select value={tab} onChange={(e) => setTab(e.target.value as Tab)}>
            <option value="pending">На модерации ({counts.pending})</option>
            <option value="approved">Одобренные ({counts.approved})</option>
            <option value="rejected">Отклонённые ({counts.rejected})</option>
            <option value="channels">Каналы</option>
            <option value="stats">📊 Аналитика</option>
          </select>
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
  { label: "24 часа", days: 1 },
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

const PAGE = 10;

function RankList({ title, rows, kind }: {
  title: string;
  rows: { target: string; views: number; uniques: number; title?: string }[];
  kind: "feed" | "channel" | "post";
}) {
  const nav = useNavigate();
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const go = (t: string) => {
    if (kind === "feed") nav(`/feed/${t}`);
    else if (kind === "channel") nav(`/channel/${t}`);
    else window.open(t, "_blank");
  };
  const name = (r: { target: string; title?: string }) =>
    kind === "feed" ? (r.title || `#${r.target}`) : kind === "channel" ? `@${r.target}` : r.target;

  // Позиция в рейтинге сохраняется даже при поиске (нумеруем ДО фильтра).
  const numbered = rows.map((r, i) => ({ ...r, pos: i + 1 }));
  const q = filter.trim().toLowerCase();
  const filtered = q ? numbered.filter((r) => name(r).toLowerCase().includes(q)) : numbered;
  const visible = q ? filtered : filtered.slice(0, limit);

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row spread" style={{ marginBottom: 8 }}>
        <span style={{ fontWeight: 800 }}>{title}</span>
        <span className="muted" style={{ fontSize: 12 }}>всего {rows.length}</span>
      </div>
      {rows.length > PAGE && (
        <input className="rank-filter" type="text" placeholder="Поиск в списке…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      )}
      {rows.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Пока нет данных.</div>}
      {visible.map((r) => (
        <button key={r.target} className="rank-row" onClick={() => go(r.target)}>
          <span className="rank-pos">{r.pos}</span>
          <span className="rank-name">{name(r)}</span>
          <span className="rank-val">{r.views} <span className="muted">/ {r.uniques} чел.</span></span>
        </button>
      ))}
      {!q && filtered.length > limit && (
        <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setLimit((l) => l + 25)}>
          Показать ещё ({filtered.length - limit})
        </button>
      )}
      {!q && limit > PAGE && filtered.length <= limit && (
        <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setLimit(PAGE)}>Свернуть</button>
      )}
    </div>
  );
}

function AnalyticsPanel() {
  const [days, setDays] = useState(30);
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState<{ from: string; to: string } | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useMemo(() => () => {
    setLoading(true); setErr("");
    const opts = applied
      ? { from: applied.from ? new Date(applied.from + "T00:00:00").toISOString() : undefined,
          to: applied.to ? new Date(applied.to + "T23:59:59").toISOString() : undefined }
      : { days };
    adminAnalytics(opts)
      .then(setStats)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [days, applied]);

  useEffect(() => { load(); }, [load]);

  const pickPreset = (d: number) => { setCustom(false); setApplied(null); setDays(d); };
  const apply = () => { if (from || to) setApplied({ from, to }); };

  const periodWord = applied
    ? `${applied.from || "начало"} — ${applied.to || "сейчас"}`
    : days > 0 ? `за ${days === 1 ? "24 часа" : days + " дн."}` : "за всё время";

  return (
    <>
      <div className="tabs-row" style={{ marginBottom: 10 }}>
        {PERIODS.map((p) => (
          <button key={p.days} className={`seg ${!applied && !custom && days === p.days ? "on" : ""}`} onClick={() => pickPreset(p.days)}>{p.label}</button>
        ))}
        <button className={`seg ${custom || applied ? "on" : ""}`} onClick={() => setCustom((v) => !v)}>Свой период</button>
      </div>

      {custom && (
        <div className="card row" style={{ gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ flex: "1 1 130px" }}>С
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label style={{ flex: "1 1 130px" }}>По
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="btn sm" onClick={apply} disabled={!from && !to}>Применить</button>
        </div>
      )}

      {err && <ErrorState message={err} onRetry={load} />}
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
