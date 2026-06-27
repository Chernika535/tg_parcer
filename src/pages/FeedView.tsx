import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getFeedById, readChannels, readChannelsMT, favoriteLinks, addFavorite, removeFavorite, type Feed, type Post } from "../lib/data.ts";
import { useAuth } from "../lib/auth.tsx";
import { Loading, ErrorState, Empty, TopBar } from "../components/States.tsx";
import PostCard from "../components/PostCard.tsx";

export default function FeedView() {
  const { id } = useParams();
  const feedId = Number(id);
  const nav = useNavigate();
  const { session } = useAuth();
  const [fav, setFav] = useState<Set<string>>(new Set());
  const [feed, setFeed] = useState<Feed | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    try {
      const f = await getFeedById(feedId);
      if (!f) throw new Error("лента не найдена или недоступна");
      setFeed(f);
      const { posts, unavailable } = await readChannels(f.channels);
      setPosts(posts);
      setUnavailable(unavailable);
      // Для каналов без превью пробуем дочитать под подключённым аккаунтом (MTProto).
      if (unavailable.length > 0) {
        const mt = await readChannelsMT(unavailable);
        if (mt.posts.length > 0) {
          setPosts((prev) => {
            const merged = [...(prev ?? []), ...mt.posts];
            merged.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
            return merged;
          });
          setUnavailable(mt.unavailable);
        }
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [feedId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (session) favoriteLinks().then((l) => setFav(new Set(l)));
  }, [session]);

  async function toggleFav(post: Post) {
    const next = new Set(fav);
    if (next.has(post.link)) {
      next.delete(post.link);
      setFav(next);
      await removeFavorite(post.link);
    } else {
      next.add(post.link);
      setFav(next);
      await addFavorite(post);
    }
  }

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <>
      <TopBar title={feed?.title || "Лента"} onBack={() => nav(-1)} />
      <div className="content">
        {feed?.description && <div className="card" style={{ padding: 14 }}>{feed.description}</div>}

        <div className="row spread">
          <span className="muted">{feed ? `${feed.channels.length} каналов` : ""}</span>
          <button className="btn ghost sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? "Обновление…" : "↻ Обновить"}
          </button>
        </div>


        {unavailable.length > 0 && (
          <div className="card">
            <div className="muted">Недоступны (превью отключено / приватный / удалён):</div>
            <div className="tags">
              {unavailable.map((c) => (
                <span key={c} className="tag">
                  @{c} <span className="badge warn">недоступен</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {err && <ErrorState message={err} onRetry={load} />}
        {!posts && !err && <Loading label="Читаю каналы…" />}
        {posts && posts.length === 0 && !err && <Empty>Постов пока нет.</Empty>}
        {posts?.map((p) => (
          <PostCard
            key={`${p.channel}/${p.msgId}`}
            post={p}
            isFav={fav.has(p.link)}
            onToggleFav={session ? toggleFav : undefined}
          />
        ))}
      </div>
    </>
  );
}
