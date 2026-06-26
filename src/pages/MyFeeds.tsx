import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { myFeeds, deleteFeed, type Feed } from "../lib/data.ts";
import { Loading, ErrorState, Empty, TopBar } from "../components/States.tsx";

function statusBadge(f: Feed) {
  if (f.visibility === "private") return <span className="badge">приватная</span>;
  if (f.status === "approved") return <span className="badge ok">опубликована</span>;
  if (f.status === "pending") return <span className="badge">на модерации</span>;
  return <span className="badge warn">отклонена</span>;
}

export default function MyFeeds() {
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [err, setErr] = useState("");
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

  return (
    <>
      <TopBar title="Мои ленты" />
      <div className="content">
        {err && <ErrorState message={err} onRetry={load} />}
        {!feeds && !err && <Loading />}
        {feeds && feeds.length === 0 && <Empty>У вас пока нет лент. Создайте первую.</Empty>}
        {feeds?.map((f) => (
          <div key={f.id} className="card row spread">
            <div className="grow" onClick={() => nav(`/feed/${f.id}`)}>
              <div className="row" style={{ gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{f.title}</span>
                {statusBadge(f)}
              </div>
              <div className="muted">{f.channels.length} каналов</div>
              {f.status === "rejected" && f.reject_reason && (
                <div className="muted" style={{ color: "var(--accent-2)" }}>
                  Причина: {f.reject_reason}
                </div>
              )}
            </div>
            <div className="row" style={{ gap: 4 }}>
              <button className="btn ghost" onClick={() => nav(`/my/${f.id}/edit`)}>
                ✎
              </button>
              <button className="btn ghost" onClick={() => remove(f.id, f.title)}>
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>
      <button className="fab" onClick={() => nav("/my/new")}>
        + Лента
      </button>
    </>
  );
}
