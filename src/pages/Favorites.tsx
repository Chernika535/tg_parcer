import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listFavorites,
  removeFavorite,
  setFavoriteFolder,
  favoriteFeeds,
  removeFeedFav,
  favTags,
  removeFavTag,
  readChannels,
  type Post,
  type Feed,
} from "../lib/data.ts";
import { Loading, ErrorState, Empty, TopBar } from "../components/States.tsx";
import PostCard from "../components/PostCard.tsx";
import FeedCard from "../components/FeedCard.tsx";
import { useLikes } from "../lib/useLikes.ts";
import { useAuth } from "../lib/auth.tsx";
import { isAdultAllowed } from "../lib/adult.ts";

type Tab = "stream" | "posts" | "feeds" | "tags";

export default function Favorites() {
  const [tab, setTab] = useState<Tab>("stream");
  const nav = useNavigate();

  const [posts, setPosts] = useState<Post[] | null>(null);
  const [folder, setFolder] = useState<string | "ALL" | "NONE">("ALL");
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [stream, setStream] = useState<Post[] | null>(null);
  const [tags, setTags] = useState<string[] | null>(null);
  const [err, setErr] = useState("");
  const { liked, toggle: toggleLike } = useLikes(true);
  const { profile } = useAuth();
  const adultOk = isAdultAllowed(profile?.birth_date);

  useEffect(() => {
    if (tab === "posts" && !posts) listFavorites().then(setPosts).catch((e) => setErr(e.message));
    if (tab === "feeds" && !feeds) favoriteFeeds().then(setFeeds).catch((e) => setErr(e.message));
    if (tab === "tags" && !tags) favTags().then(setTags).catch((e) => setErr(e.message));
    if (tab === "stream") loadStream();
  }, [tab, adultOk]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadStream() {
    setErr("");
    try {
      const favs = feeds ?? (await favoriteFeeds());
      setFeeds(favs);
      // Каналы из лент 18+ не показываем, если возраст не подтверждён.
      const src = adultOk ? favs : favs.filter((f) => !f.adult);
      const channels = [...new Set(src.flatMap((f) => f.channels))];
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
  async function changeFolder(post: Post, value: string) {
    let folderName: string | null;
    if (value === "__new__") {
      const name = prompt("Название папки:")?.trim();
      if (!name) return;
      folderName = name;
    } else {
      folderName = value === "" ? null : value;
    }
    setPosts((prev) => (prev ?? []).map((p) => (p.link === post.link ? { ...p, folder: folderName } : p)));
    try { await setFavoriteFolder(post.link, folderName); } catch { /* откат не критичен */ }
  }
  async function unfavFeed(f: Feed) {
    await removeFeedFav(f.id);
    setFeeds((prev) => (prev ?? []).filter((x) => x.id !== f.id));
    setStream(null); // пересоберётся
  }
  async function unfavTag(t: string) {
    await removeFavTag(t);
    setTags((prev) => (prev ?? []).filter((x) => x !== t));
  }

  return (
    <>
      <TopBar title="Избранное" />
      <div className="content">
        <div className="tabs-row">
          <button className={`seg ${tab === "stream" ? "on" : ""}`} onClick={() => setTab("stream")}>Лента</button>
          <button className={`seg ${tab === "posts" ? "on" : ""}`} onClick={() => setTab("posts")}>Посты</button>
          <button className={`seg ${tab === "feeds" ? "on" : ""}`} onClick={() => setTab("feeds")}>Ленты</button>
          <button className={`seg ${tab === "tags" ? "on" : ""}`} onClick={() => setTab("tags")}>Теги</button>
        </div>

        {err && <ErrorState message={err} onRetry={() => { setErr(""); setPosts(null); setFeeds(null); setStream(null); }} />}

        {tab === "posts" && (() => {
          const folders = [...new Set((posts ?? []).map((p) => p.folder).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
          const shown = (posts ?? []).filter((p) =>
            folder === "ALL" ? true : folder === "NONE" ? !p.folder : p.folder === folder,
          );
          return (
            <>
              {!posts && !err && <Loading />}
              {posts && posts.length === 0 && <Empty>Пока пусто. Нажимайте ♥ на постах.</Empty>}
              {posts && posts.length > 0 && (() => {
                const noneCount = (posts ?? []).filter((p) => !p.folder).length;
                const countOf = (f: string) => (posts ?? []).filter((p) => p.folder === f).length;
                return (
                  <div style={{ marginBottom: 10 }}>
                    <div className="folder-grid">
                      <button className={`folder-tile ${folder === "NONE" ? "on" : ""}`} onClick={() => setFolder(folder === "NONE" ? "ALL" : "NONE")}>
                        <span className="folder-box plain"><span className="folder-cnt">{noneCount}</span></span>
                        <span className="folder-name">Без папки</span>
                      </button>
                      {folders.map((f, i) => (
                        <button key={f} className={`folder-tile ${folder === f ? "on" : ""}`} onClick={() => setFolder(folder === f ? "ALL" : f)}>
                          <span className={`folder-box c${i % 3}`}><span className="folder-cnt">{countOf(f)}</span></span>
                          <span className="folder-name">{f}</span>
                        </button>
                      ))}
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      {folder === "ALL" ? "Показаны все избранные посты. Нажмите папку, чтобы открыть её." : (
                        <button className="btn ghost sm" style={{ padding: 0 }} onClick={() => setFolder("ALL")}>← Показать все</button>
                      )}
                    </div>
                  </div>
                );
              })()}
              {shown.map((p) => (
                <div key={p.link}>
                  <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 4 }}>
                    <span className="muted" style={{ fontSize: 12 }}>Папка:</span>
                    <select
                      className="folder-select"
                      value={p.folder ?? ""}
                      onChange={(e) => changeFolder(p, e.target.value)}
                    >
                      <option value="">Без папки</option>
                      {folders.map((f) => <option key={f} value={f}>{f}</option>)}
                      <option value="__new__">＋ Новая папка…</option>
                    </select>
                  </div>
                  <PostCard post={p} isFav onToggleFav={unfavPost} isLiked={liked.has(p.link)} onToggleLike={toggleLike} />
                </div>
              ))}
            </>
          );
        })()}

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

        {tab === "tags" && (
          <>
            {!tags && !err && <Loading />}
            {tags && tags.length === 0 && <Empty>Нет избранных тегов. Откройте тег и нажмите «В избранное».</Empty>}
            <div className="chip-row">
              {tags?.map((t) => (
                <span key={t} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <button className="chip-btn" style={{ border: "none", background: "none", padding: 0, font: "inherit", cursor: "pointer" }} onClick={() => nav(`/tag/${encodeURIComponent(t)}`)}>#{t}</button>
                  <button className="chip-x" onClick={() => unfavTag(t)} aria-label="Убрать">✕</button>
                </span>
              ))}
            </div>
          </>
        )}

        {tab === "stream" && (
          <>
            {!stream && !err && <Loading label="Собираю ленту из избранных…" />}
            {stream && stream.length === 0 && <Empty>Пусто. Добавьте ленты в избранное.</Empty>}
            {stream?.map((p) => <PostCard key={`${p.channel}/${p.msgId}`} post={p} isLiked={liked.has(p.link)} onToggleLike={toggleLike} />)}
          </>
        )}
      </div>
    </>
  );
}
