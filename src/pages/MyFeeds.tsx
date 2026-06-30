import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { myFeeds, deleteFeed, type Feed } from "../lib/data.ts";
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

export default function MyFeeds() {
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [err, setErr] = useState("");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const nav = useNavigate();

  async function load() {
    setErr("");
    try {
      setFeeds(await myFeeds());
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function remove(id: number, title: string) {
    if (!confirm(`Удалить ленту «${title}»?`)) return;
    await deleteFeed(id);
    load();
  }

  const allTags = useMemo(() => allTagsOf(feeds ?? []), [feeds]);
  const shown = useMemo(() => applyFilters(feeds ?? [], filters), [feeds, filters]);

  return (
    <>
      <TopBar title="Мои ленты" subtitle="Приватные и общедоступные подборки" />
      <div className="content">
        {feeds && feeds.length > 0 && (
          <FeedFilter filters={filters} setFilters={setFilters} allTags={allTags} />
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
              actions={
                <>
                  {canOwnerEdit(f) ? (
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
