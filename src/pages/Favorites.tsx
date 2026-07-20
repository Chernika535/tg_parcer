import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listFavorites,
  favoriteLinks,
  addFavorite,
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
  const [streamDays, setStreamDays] = useState(0); // 0 = только сегодня, +1 день за клик
  const [tags, setTags] = useState<string[] | null>(null);
  const [err, setErr] = useState("");
  const [postQuery, setPostQuery] = useState("");
  const [streamFav, setStreamFav] = useState<Set<string>>(new Set()); // избранные посты (для звёздочки в Ленте)
  const [repairing, setRepairing] = useState(false);
  const { liked, toggle: toggleLike } = useLikes(true);
  const { profile } = useAuth();
  const adultOk = isAdultAllowed(profile?.birth_date);

  // Пометить/снять пост в избранном прямо из «Ленты» (или любого потока постов).
  async function toggleStreamFav(post: Post) {
    const next = new Set(streamFav);
    if (next.has(post.link)) {
      next.delete(post.link); setStreamFav(next);
      await removeFavorite(post.link);
      setPosts((prev) => (prev ? prev.filter((p) => p.link !== post.link) : prev));
    } else {
      next.add(post.link); setStreamFav(next);
      await addFavorite(post);
      setPosts(null); // список сохранённых пересоберётся при заходе во вкладку
    }
  }

  // Разовая «починка» картинок у уже сохранённых постов: перечитываем каналы и
  // пере-сохраняем найденные посты (теперь картинки копируются в наш Storage).
  async function repairPosts() {
    setRepairing(true); setErr("");
    try {
      const favs = await listFavorites();
      const channels = [...new Set(favs.map((p) => p.channel))];
      const { posts: fresh } = await readChannels(channels, { fresh: true });
      const byKey = new Map(fresh.map((p) => [`${p.channel}/${p.msgId}`, p]));
      let fixed = 0;
      for (const f of favs) {
        const fp = byKey.get(`${f.channel}/${f.msgId}`);
        if (fp && fp.media.length > 0) { await addFavorite({ ...fp, folder: f.folder }); fixed++; }
      }
      setPosts(null);
      setErr(fixed ? "" : "Свежих версий постов не нашлось — часть постов уже недоступна в каналах.");
      if (tab === "posts") listFavorites().then(setPosts).catch(() => {});
    } catch (e) {
      setErr("Не удалось обновить: " + (e as Error).message);
    } finally {
      setRepairing(false);
    }
  }

  useEffect(() => { favoriteLinks().then((l) => setStreamFav(new Set(l))).catch(() => {}); }, []);

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
          const q = postQuery.trim().toLowerCase();
          const shown = (posts ?? [])
            .filter((p) => (folder === "ALL" ? true : folder === "NONE" ? !p.folder : p.folder === folder))
            .filter((p) => !q || (p.text || "").replace(/<[^>]+>/g, "").toLowerCase().includes(q) || p.channel.toLowerCase().includes(q));
          return (
            <>
              {!posts && !err && <Loading />}
              {posts && posts.length > 0 && (
                <div className="search" style={{ marginBottom: 8 }}>
                  <span className="search-ico">🔍</span>
                  <input type="text" placeholder="Поиск по тексту постов…" value={postQuery} onChange={(e) => setPostQuery(e.target.value)} />
                  {postQuery && <button className="search-clear" onClick={() => setPostQuery("")} aria-label="Очистить">✕</button>}
                </div>
              )}
              {posts && posts.length > 0 && (
                <div className="row spread" style={{ marginBottom: 8 }}>
                  <span className="muted" style={{ fontSize: 12 }}>Картинки у старых постов не грузятся? Обновите их из каналов.</span>
                  <button className="btn ghost sm" onClick={repairPosts} disabled={repairing}>
                    {repairing ? "Обновляю…" : "↻ Обновить картинки"}
                  </button>
                </div>
              )}
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

        {tab === "stream" && (() => {
          // Сначала показываем только сегодняшние посты, по кнопке — на день раньше.
          const now = new Date();
          const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - streamDays).getTime();
          const shownStream = (stream ?? []).filter((p) => new Date(p.postedAt).getTime() >= cutoff);
          const hasOlder = (stream ?? []).some((p) => new Date(p.postedAt).getTime() < cutoff);
          return (
            <>
              {!stream && !err && <Loading label="Собираю ленту из избранных…" />}
              {stream && stream.length === 0 && <Empty>Пусто. Добавьте ленты в избранное.</Empty>}
              {stream && stream.length > 0 && shownStream.length === 0 && (
                <div className="muted" style={{ padding: "8px 0" }}>За сегодня постов нет.</div>
              )}
              {shownStream.map((p) => <PostCard key={`${p.channel}/${p.msgId}`} post={p} isFav={streamFav.has(p.link)} onToggleFav={toggleStreamFav} isLiked={liked.has(p.link)} onToggleLike={toggleLike} />)}
              {hasOlder && (
                <button className="btn secondary" style={{ margin: "8px auto", display: "block" }} onClick={() => setStreamDays((d) => d + 1)}>
                  Показать более ранние посты
                </button>
              )}
            </>
          );
        })()}
      </div>
    </>
  );
}
