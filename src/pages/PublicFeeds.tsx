import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { loadPublic, feedFavIds, addFeedFav, removeFeedFav, setPin, removePin, cacheFeedMetas, type Feed, type Pin } from "../lib/data.ts";
import { useAuth } from "../lib/auth.tsx";
import { Loading, ErrorState, Empty, TopBar } from "../components/States.tsx";
import FeedCard from "../components/FeedCard.tsx";
import FeedFilter, { applyFilters, allTagsOf, emptyFilters, type Filters } from "../components/FeedFilter.tsx";

export default function PublicFeeds() {
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [favIds, setFavIds] = useState<Set<number>>(new Set());
  const [err, setErr] = useState("");
  const [params] = useSearchParams();
  const { session, isAdmin } = useAuth();
  const [filters, setFilters] = useState<Filters>(() => {
    const t = params.get("tag");
    return { ...emptyFilters, tags: t ? [t.toLowerCase()] : [] };
  });
  const nav = useNavigate();

  async function load() {
    setErr("");
    try {
      const { feeds, pins } = await loadPublic();
      setFeeds(feeds);
      setPins(pins);
      try { localStorage.setItem("tf_public_feeds", JSON.stringify(feeds)); } catch { /* ignore */ }
      cacheFeedMetas(feeds); // каждую ленту — в кэш для аварийного восстановления
    } catch (e) {
      try {
        const s = localStorage.getItem("tf_public_feeds");
        if (s) { setFeeds(JSON.parse(s) as Feed[]); return; }
      } catch { /* ignore */ }
      setErr((e as Error).message);
    }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (session) feedFavIds().then((ids) => setFavIds(new Set(ids))); }, [session]);

  const allTags = useMemo(() => allTagsOf(feeds ?? []), [feeds]);
  // Контекст закрепления: если выбран ровно один тег — закрепления этой категории, иначе общей.
  const contextTag = filters.tags.length === 1 ? filters.tags[0] : "";
  const shown = useMemo(() => {
    const filtered = applyFilters(feeds ?? [], filters);
    const pinIds = pins.filter((p) => p.tag === contextTag).sort((a, b) => b.rank - a.rank).map((p) => p.feed_id);
    const pinned: Feed[] = [];
    const rest: Feed[] = [];
    for (const f of filtered) (pinIds.includes(f.id) ? pinned : rest).push(f);
    pinned.sort((a, b) => pinIds.indexOf(a.id) - pinIds.indexOf(b.id));
    return { pinned, rest };
  }, [feeds, filters, pins, contextTag]);

  async function toggleLike(f: Feed) {
    const next = new Set(favIds);
    if (next.has(f.id)) { next.delete(f.id); setFavIds(next); await removeFeedFav(f.id); }
    else { next.add(f.id); setFavIds(next); await addFeedFav(f.id); }
  }
  async function togglePin(f: Feed) {
    const isPinned = pins.some((p) => p.feed_id === f.id && p.tag === contextTag);
    if (isPinned) { setPins((p) => p.filter((x) => !(x.feed_id === f.id && x.tag === contextTag))); await removePin(f.id, contextTag); }
    else { setPins((p) => [...p, { feed_id: f.id, tag: contextTag, rank: 0 }]); await setPin(f.id, contextTag, Date.now() % 100000); }
  }

  function card(f: Feed) {
    const pinned = pins.some((p) => p.feed_id === f.id && p.tag === contextTag);
    return (
      <FeedCard
        key={f.id}
        feed={f}
        onOpen={() => nav(`/feed/${f.id}`)}
        liked={favIds.has(f.id)}
        onToggleLike={session ? () => toggleLike(f) : undefined}
        actions={isAdmin ? (
          <button className="btn ghost sm" onClick={() => togglePin(f)}>
            {pinned ? "📌 открепить" : "📌 закрепить" + (contextTag ? ` в #${contextTag}` : "")}
          </button>
        ) : undefined}
      />
    );
  }

  return (
    <>
      <TopBar title="Ленты" />
      <div className="content">
        {feeds && feeds.length > 0 && <FeedFilter filters={filters} setFilters={setFilters} allTags={allTags} />}
        {err && <ErrorState message={err} onRetry={load} />}
        {!feeds && !err && <Loading />}
        {feeds && feeds.length === 0 && <Empty>Пока нет опубликованных лент.</Empty>}
        {feeds && feeds.length > 0 && shown.pinned.length === 0 && shown.rest.length === 0 && <Empty>Ничего не найдено.</Empty>}

        {shown.pinned.length > 0 && (
          <>
            <div className="muted" style={{ fontWeight: 800, margin: "4px 0" }}>📌 Закреплённые</div>
            <div className="feed-grid">{shown.pinned.map(card)}</div>
          </>
        )}
        <div className="feed-grid">{shown.rest.map(card)}</div>
      </div>
    </>
  );
}
