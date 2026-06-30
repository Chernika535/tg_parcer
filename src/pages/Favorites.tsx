import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listFavorites,
  removeFavorite,
  favoriteFeeds,
  removeFeedFav,
  readChannels,
  type Post,
  type Feed,
} from "../lib/data.ts";
import { Loading, ErrorState, Empty, TopBar } from "../components/States.tsx";
import PostCard from "../components/PostCard.tsx";
import FeedCard from "../components/FeedCard.tsx";

type Tab = "posts" | "feeds" | "stream";

export default function Favorites() {
  const [tab, setTab] = useState<Tab>("posts");
  const nav = useNavigate();

  const [posts, setPosts] = useState<Post[] | null>(null);
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [stream, setStream] = useState<Post[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (tab === "posts" && !posts) listFavorites().then(setPosts).catch((e) => setErr(e.message));
    if (tab === "feeds" && !feeds) favoriteFeeds().then(setFeeds).catch((e) => setErr(e.message));
    if (tab === "stream" && !stream) loadStream();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadStream() {
    setErr("");
    try {
      const favs = feeds ?? (await favoriteFeeds());
      setFeeds(favs);
      const channels = [...new Set(favs.flatMap((f) => f.channels))];
      if (channels.length === 0) { setStream([]); return; }
      const { posts: p } = await readChannels(channels);
      setStream(p);
    } catch (e) {
      setErr((e as Error).message);
      setStream([]);
    }
  }

  async function unfavPost(post: Post) {
    await removeFavorite(post.link);
    setPosts((prev) => (prev ?? []).filter((p) => p.link !== post.link));
  }
  async function unfavFeed(f: Feed) {
    await removeFeedFav(f.id);
    setFeeds((prev) => (prev ?? []).filter((x) => x.id !== f.id));
    setStream(null); // пересоберётся
  }

  return (
    <>
      <TopBar title="Избранное" />
      <div className="content">
        <div className="tabs-row">
          <button className={`seg ${tab === "posts" ? "on" : ""}`} onClick={() => setTab("posts")}>Посты</button>
          <button className={`seg ${tab === "feeds" ? "on" : ""}`} onClick={() => setTab("feeds")}>Ленты</button>
          <button className={`seg ${tab === "stream" ? "on" : ""}`} onClick={() => setTab("stream")}>Общая лента</button>
        </div>

        {err && <ErrorState message={err} onRetry={() => { setErr(""); setPosts(null); setFeeds(null); setStream(null); }} />}

        {tab === "posts" && (
          <>
            {!posts && !err && <Loading />}
            {posts && posts.length === 0 && <Empty>Пока пусто. Нажимайте ♥ на постах.</Empty>}
            {posts?.map((p) => <PostCard key={p.link} post={p} isFav onToggleFav={unfavPost} />)}
          </>
        )}

        {tab === "feeds" && (
          <>
            {!feeds && !err && <Loading />}
            {feeds && feeds.length === 0 && <Empty>Нет избранных лент. Нажимайте ♥ на карточке ленты.</Empty>}
            <div className="feed-grid">
              {feeds?.map((f) => (
                <FeedCard key={f.id} feed={f} onOpen={() => nav(`/feed/${f.id}`)} liked onToggleLike={() => unfavFeed(f)} />
              ))}
            </div>
          </>
        )}

        {tab === "stream" && (
          <>
            {!stream && !err && <Loading label="Собираю ленту из избранных…" />}
            {stream && stream.length === 0 && <Empty>Пусто. Добавьте ленты в избранное.</Empty>}
            {stream?.map((p) => <PostCard key={`${p.channel}/${p.msgId}`} post={p} />)}
          </>
        )}
      </div>
    </>
  );
}
