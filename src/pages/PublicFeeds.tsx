import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { publicFeeds, type Feed } from "../lib/data.ts";
import { Loading, ErrorState, Empty, TopBar } from "../components/States.tsx";
import FeedCard from "../components/FeedCard.tsx";
import FeedFilter, { filterFeeds, allTagsOf } from "../components/FeedFilter.tsx";
import Footer from "../components/Footer.tsx";

export default function PublicFeeds() {
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string[]>([]);
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

  const allTags = useMemo(() => allTagsOf(feeds ?? []), [feeds]);
  const shown = useMemo(() => filterFeeds(feeds ?? [], query, active), [feeds, query, active]);
  const toggleTag = (t: string) =>
    setActive((a) => (a.includes(t) ? a.filter((x) => x !== t) : [...a, t]));

  return (
    <>
      <TopBar title="ТелеФид" subtitle="Общедоступные подборки каналов" />
      <div className="content">
        {feeds && feeds.length > 0 && (
          <FeedFilter
            query={query}
            setQuery={setQuery}
            allTags={allTags}
            active={active}
            toggleTag={toggleTag}
          />
        )}
        {err && <ErrorState message={err} onRetry={load} />}
        {!feeds && !err && <Loading />}
        {feeds && feeds.length === 0 && <Empty>Пока нет опубликованных лент.</Empty>}
        {feeds && feeds.length > 0 && shown.length === 0 && <Empty>Ничего не найдено.</Empty>}
        <div className="feed-grid">
          {shown.map((f) => (
            <FeedCard key={f.id} feed={f} onOpen={() => nav(`/feed/${f.id}`)} />
          ))}
        </div>
        <Footer />
      </div>
    </>
  );
}
