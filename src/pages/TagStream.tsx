import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { loadPublic, readChannels, favTags, addFavTag, removeFavTag, favoriteLinks, addFavorite, removeFavorite, type Post } from "../lib/data.ts";
import { useAuth } from "../lib/auth.tsx";
import { Loading, Empty, TopBar } from "../components/States.tsx";
import PostCard from "../components/PostCard.tsx";
import { useLikes } from "../lib/useLikes.ts";
import { isAdultAllowed } from "../lib/adult.ts";

// Лента из всех публичных лент с заданным тегом.
export default function TagStream() {
  const { tag = "" } = useParams();
  const t = tag.toLowerCase();
  const nav = useNavigate();
  const { session, profile } = useAuth();
  const adultOk = isAdultAllowed(profile?.birth_date);
  const { liked, toggle: toggleLike } = useLikes(!!session);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [count, setCount] = useState(0);
  const [fav, setFav] = useState(false);
  const [postFav, setPostFav] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (session) favoriteLinks().then((l) => setPostFav(new Set(l))).catch(() => {});
  }, [session]);

  async function togglePostFav(post: Post) {
    const next = new Set(postFav);
    if (next.has(post.link)) { next.delete(post.link); setPostFav(next); await removeFavorite(post.link); }
    else { next.add(post.link); setPostFav(next); await addFavorite(post); }
  }

  useEffect(() => {
    (async () => {
      setPosts(null);
      try {
        const { feeds } = await loadPublic();
        let tagged = feeds.filter((f) => (f.tags || []).includes(t));
        // Ленты 18+ скрываем, если возраст не подтверждён / нет даты рождения.
        if (!adultOk) tagged = tagged.filter((f) => !f.adult);
        setCount(tagged.length);
        const channels = [...new Set(tagged.flatMap((f) => f.channels))];
        if (channels.length === 0) { setPosts([]); return; }
        const { posts } = await readChannels(channels);
        setPosts(posts);
      } catch {
        setPosts([]);
      }
    })();
  }, [t, adultOk]);

  useEffect(() => {
    if (session) favTags().then((tags) => setFav(tags.includes(t)));
  }, [session, t]);

  async function toggleFav() {
    if (fav) { setFav(false); await removeFavTag(t); }
    else { setFav(true); await addFavTag(t); }
  }

  return (
    <>
      <TopBar title={`#${t}`} onBack={() => nav(-1)} />
      <div className="content">
        <div className="row spread">
          <span className="muted">{count} лент с этим тегом</span>
          <div className="row" style={{ gap: 8 }}>
            {session && (
              <button className={`btn sm ${fav ? "" : "secondary"}`} onClick={toggleFav}>
                {fav ? "♥ В избранном" : "♡ В избранное"}
              </button>
            )}
            <button className="btn ghost sm" onClick={() => nav(`/feeds?tag=${encodeURIComponent(t)}`)}>
              Ленты с тегом →
            </button>
          </div>
        </div>

        {!posts && <Loading label="Собираю ленту по тегу…" />}
        {posts && posts.length === 0 && <Empty>Постов по этому тегу пока нет.</Empty>}
        {posts?.map((p) => (
          <PostCard
            key={`${p.channel}/${p.msgId}`}
            post={p}
            isFav={postFav.has(p.link)}
            onToggleFav={session ? togglePostFav : undefined}
            isLiked={liked.has(p.link)}
            onToggleLike={session ? toggleLike : undefined}
          />
        ))}
      </div>
    </>
  );
}
