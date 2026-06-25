import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type FeedListItem } from "../api.ts";
import { Loading, ErrorState, Empty, TopBar } from "../components/States.tsx";

export default function FeedsList() {
  const [feeds, setFeeds] = useState<FeedListItem[] | null>(null);
  const [err, setErr] = useState("");
  const nav = useNavigate();

  async function load() {
    setErr("");
    try {
      setFeeds(await api.listFeeds());
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    const title = prompt("Название ленты");
    if (!title?.trim()) return;
    const f = await api.createFeed(title.trim());
    nav(`/feeds/${f.id}`);
  }

  async function remove(id: number, title: string) {
    if (!confirm(`Удалить ленту «${title}»?`)) return;
    await api.deleteFeed(id);
    load();
  }

  return (
    <>
      <TopBar title="Ленты" />
      <div className="content">
        {err && <ErrorState message={err} onRetry={load} />}
        {!feeds && !err && <Loading />}
        {feeds && feeds.length === 0 && <Empty>Пока нет лент. Создайте первую.</Empty>}
        {feeds?.map((f) => (
          <div key={f.id} className="card row spread" onClick={() => nav(`/feeds/${f.id}`)}>
            <div>
              <div style={{ fontWeight: 600 }}>{f.title}</div>
              <div className="muted">{f.channelCount} каналов</div>
            </div>
            <button
              className="btn ghost"
              onClick={(e) => {
                e.stopPropagation();
                remove(f.id, f.title);
              }}
            >
              🗑
            </button>
          </div>
        ))}
      </div>
      <button className="fab" onClick={create}>
        + Лента
      </button>
    </>
  );
}
