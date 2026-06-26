import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { publicFeeds, type Feed } from "../lib/data.ts";
import { Loading, ErrorState, Empty, TopBar } from "../components/States.tsx";

export default function PublicFeeds() {
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [err, setErr] = useState("");
  const nav = useNavigate();

  async function load() {
    setErr("");
    try {
      setFeeds(await publicFeeds());
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <TopBar title="Общедоступные ленты" />
      <div className="content">
        {err && <ErrorState message={err} onRetry={load} />}
        {!feeds && !err && <Loading />}
        {feeds && feeds.length === 0 && <Empty>Пока нет опубликованных лент.</Empty>}
        {feeds?.map((f) => (
          <div key={f.id} className="card" onClick={() => nav(`/feed/${f.id}`)}>
            <div style={{ fontWeight: 600 }}>{f.title}</div>
            <div className="muted">
              {f.channels.length} каналов
              {f.owner?.display_name ? ` · ${f.owner.display_name}` : ""}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
