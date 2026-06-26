import { useEffect, useState } from "react";
import { listFavorites, removeFavorite, type Post } from "../lib/data.ts";
import { Loading, ErrorState, Empty, TopBar } from "../components/States.tsx";
import PostCard from "../components/PostCard.tsx";

export default function Favorites() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [err, setErr] = useState("");

  async function load() {
    setErr("");
    try {
      setPosts(await listFavorites());
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function toggle(post: Post) {
    await removeFavorite(post.link);
    setPosts((prev) => (prev ?? []).filter((p) => p.link !== post.link));
  }

  return (
    <>
      <TopBar title="Избранное" />
      <div className="content">
        {err && <ErrorState message={err} onRetry={load} />}
        {!posts && !err && <Loading />}
        {posts && posts.length === 0 && <Empty>Пока пусто. Нажимайте ♥ на постах в ленте.</Empty>}
        {posts?.map((p) => (
          <PostCard key={p.link} post={p} isFav onToggleFav={toggle} />
        ))}
      </div>
    </>
  );
}
