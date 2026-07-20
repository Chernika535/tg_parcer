import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { likedPosts, likedChannels, likeChannel, type Post } from "../lib/data.ts";
import { Loading, Empty, TopBar } from "../components/States.tsx";
import PostCard from "../components/PostCard.tsx";
import { useLikes } from "../lib/useLikes.ts";

type Tab = "posts" | "channels";

// Раздел «Понравилось»: посты и каналы, которым пользователь поставил ♥.
export default function LikedView() {
  const [tab, setTab] = useState<Tab>("posts");
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [channels, setChannels] = useState<string[] | null>(null);
  const nav = useNavigate();
  const { liked, toggle } = useLikes(true);

  useEffect(() => {
    if (tab === "posts" && !posts) likedPosts().then(setPosts).catch(() => setPosts([]));
    if (tab === "channels" && !channels) likedChannels().then(setChannels).catch(() => setChannels([]));
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function unlikeChannel(ch: string) {
    setChannels((prev) => (prev ?? []).filter((x) => x !== ch));
    await likeChannel(ch, false);
  }

  return (
    <>
      <TopBar title="Понравилось" subtitle="Посты и каналы, которым вы поставили ♥" />
      <div className="content">
        <div className="tabs-row">
          <button className={`seg ${tab === "posts" ? "on" : ""}`} onClick={() => setTab("posts")}>Посты</button>
          <button className={`seg ${tab === "channels" ? "on" : ""}`} onClick={() => setTab("channels")}>Каналы</button>
        </div>

        {tab === "posts" && (
          <>
            {!posts && <Loading />}
            {posts && posts.length === 0 && <Empty>Пока пусто. Нажимайте ♥ на постах.</Empty>}
            {posts?.map((p) => (
              <PostCard key={`${p.channel}/${p.msgId}`} post={p} isLiked={liked.has(p.link)} onToggleLike={toggle} />
            ))}
          </>
        )}

        {tab === "channels" && (
          <>
            {!channels && <Loading />}
            {channels && channels.length === 0 && <Empty>Пока пусто. Нажимайте ♥ на странице канала.</Empty>}
            {channels?.map((ch) => (
              <div key={ch} className="card row spread" style={{ alignItems: "center" }}>
                <Link to={`/channel/${ch}`} style={{ fontWeight: 700 }} onClick={() => nav(`/channel/${ch}`)}>@{ch}</Link>
                <button className="btn ghost sm" onClick={() => unlikeChannel(ch)}>Убрать ♥</button>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
