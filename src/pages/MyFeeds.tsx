import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth.tsx";
import { myFeeds, deleteFeed, myPins, addMyPin, removeMyPin, cacheFeedMetas, feedFavIds, addFeedFav, removeFeedFav, type Feed } from "../lib/data.ts";
import { Loading, ErrorState, Empty, TopBar } from "../components/States.tsx";
import FeedCard from "../components/FeedCard.tsx";
import FeedFilter, { applyFilters, allTagsOf, emptyFilters, type Filters } from "../components/FeedFilter.tsx";

// Владелец может править только приватные и отклонённые. Публичные на модерации/
// одобренные правит администратор (так просили).
function canOwnerEdit(f: Feed) {
  return f.visibility === "private" || f.status === "rejected";
}

function statusBadge(f: Feed) {
  if (f.visibility === "private") return null;
  if (f.status === "approved") return <span className="badge ok">опубликована</span>;
  if (f.status === "pending") return <span className="badge">на модерации</span>;
  return <span className="badge warn">отклонена</span>;
}

type Vis = "all" | "private" | "public";

// localStorage — только мгновенный кэш для показа до ответа сервера. Источник
// правды — сервер (feed_personal_pins), поэтому закрепления не теряются при
// выходе/входе и на других устройствах.
function loadPinsCache(): Set<number> {
  try { return new Set(JSON.parse(localStorage.getItem("tf_mypins") || "[]") as number[]); } catch { return new Set(); }
}
function savePinsCache(s: Set<number>) {
  try { localStorage.setItem("tf_mypins", JSON.stringify([...s])); } catch { /* ignore */ }
}

export default function MyFeeds() {
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [err, setErr] = useState("");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [vis, setVis] = useState<Vis>("private");
  const [pins, setPins] = useState<Set<number>>(() => loadPinsCache());
  const [favIds, setFavIds] = useState<Set<number>>(new Set());
  const { isAdmin, session } = useAuth();
  const nav = useNavigate();

  async function toggleFav(f: Feed) {
    const next = new Set(favIds);
    if (next.has(f.id)) { next.delete(f.id); setFavIds(next); await removeFeedFav(f.id); }
    else { next.add(f.id); setFavIds(next); await addFeedFav(f.id); }
  }

  async function load() {
    setErr("");
    try {
      const mine = await myFeeds();
      setFeeds(mine);
      cacheFeedMetas(mine);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
    // Подтягиваем закрепления с сервера (кэш уже показан из localStorage).
    myPins().then((ids) => {
      const s = new Set(ids);
      setPins(s);
      savePinsCache(s);
    }).catch(() => {});
    feedFavIds().then((ids) => setFavIds(new Set(ids))).catch(() => {});
  }, []);

  async function remove(id: number, title: string) {
    if (!confirm(`Удалить ленту «${title}»?`)) return;
    await deleteFeed(id);
    load();
  }

  function togglePin(id: number) {
    setPins((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); removeMyPin(id); } else { next.add(id); addMyPin(id); }
      savePinsCache(next);
      return next;
    });
  }

  const allTags = useMemo(() => allTagsOf(feeds ?? []), [feeds]);
  const shown = useMemo(() => {
    let list = applyFilters(feeds ?? [], filters);
    if (vis !== "all") list = list.filter((f) => f.visibility === vis);
    // Закреплённые — вверх (по локальному списку).
    return [...list].sort((a, b) => Number(pins.has(b.id)) - Number(pins.has(a.id)));
  }, [feeds, filters, vis, pins]);

  return (
    <>
      <TopBar title="Мои ленты" subtitle="Приватные и общедоступные подборки" />
      <div className="content">
        {feeds && feeds.length > 0 && (
          <>
            <div className="tabs-row">
              <button className={`seg ${vis === "all" ? "on" : ""}`} onClick={() => setVis("all")}>Все</button>
              <button className={`seg ${vis === "private" ? "on" : ""}`} onClick={() => setVis("private")}>Личные</button>
              <button className={`seg ${vis === "public" ? "on" : ""}`} onClick={() => setVis("public")}>Публичные</button>
            </div>
            <FeedFilter filters={filters} setFilters={setFilters} allTags={allTags} />
          </>
        )}
        {err && <ErrorState message={err} onRetry={load} />}
        {!feeds && !err && <Loading />}
        {feeds && feeds.length === 0 && <Empty>У вас пока нет лент. Создайте первую.</Empty>}
        {feeds && feeds.length > 0 && shown.length === 0 && <Empty>Ничего не найдено.</Empty>}
        <div className="feed-grid">
          {shown.map((f) => (
            <FeedCard
              key={f.id}
              feed={f}
              onOpen={() => nav(`/feed/${f.id}`)}
              statusBadge={statusBadge(f)}
              note={f.status === "rejected"
                ? <>🔒 Отклонена — видна только вам{f.reject_reason ? ` · причина: ${f.reject_reason}` : ""}. Можно спокойно пользоваться как личной или удалить.</>
                : undefined}
              liked={favIds.has(f.id)}
              onToggleLike={session ? () => toggleFav(f) : undefined}
              actions={
                <>
                  <button className="btn ghost sm" onClick={() => togglePin(f.id)} title="Закрепить у себя">
                    {pins.has(f.id) ? "📌 Закреплена" : "📌 Закрепить"}
                  </button>
                  {isAdmin || canOwnerEdit(f) ? (
                    <button className="btn secondary sm" onClick={() => nav(`/my/${f.id}/edit`)}>
                      ✎ Изменить
                    </button>
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {f.status === "pending" ? "на модерации — правит админ" : "опубликована — правит админ"}
                    </span>
                  )}
                  <button className="btn ghost sm" onClick={() => remove(f.id, f.title)}>
                    🗑
                  </button>
                </>
              }
            />
          ))}
        </div>
      </div>
      <button className="fab" onClick={() => nav("/my/new")}>
        + Лента
      </button>
    </>
  );
}
