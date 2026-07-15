import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  channelsInfo, readChannels, readChannelsMTServer, readChannelsMT, readChannelsBefore,
  loadPublic, favoriteLinks, addFavorite, removeFavorite, archivedPosts, channelLinks, setChannelSocial,
  pinnedPost, pinPost, unpinPost, channelPinnedBot, authorChannels, channelStats, track,
  type Post, type ChannelInfo, type Feed,
} from "../lib/data.ts";
import { useAuth } from "../lib/auth.tsx";
import { Loading, Empty, TopBar } from "../components/States.tsx";
import PostCard from "../components/PostCard.tsx";
import { linkify } from "../lib/linkify.tsx";
import { useLikes } from "../lib/useLikes.ts";
import { tgUrl } from "../lib/share.ts";

function normCh(c: string): string {
  return c.trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^t\.me\//, "").replace(/^s\//, "").replace(/^@/, "")
    .split(/[/?#]/)[0].replace(/[^a-z0-9_]/g, "");
}

// TikTok: из ввода (ссылка или @ник) делаем корректный URL и «ник» для показа.
function tiktokHref(v: string): string {
  const raw = (v || "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://www.tiktok.com/@${raw.replace(/^@/, "")}`;
}
function tiktokNick(v: string): string {
  const m = (v || "").match(/tiktok\.com\/@?([^/?#]+)/i);
  return "@" + (m ? m[1] : (v || "").replace(/^@/, "")).replace(/^@/, "");
}

// Страница одного канала: шапка (название/ник/описание/в каких лентах) + посты.
export default function ChannelView() {
  const { channel = "" } = useParams();
  const ch = normCh(channel);
  const nav = useNavigate();
  const { session } = useAuth();

  const [info, setInfo] = useState<ChannelInfo | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [inFeeds, setInFeeds] = useState<Feed[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [noMore, setNoMore] = useState(false);
  const [fav, setFav] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState<Post | null>(null);
  const [pinnedId, setPinnedId] = useState<number | null>(null);
  const [pinText, setPinText] = useState("");
  const [myChatId, setMyChatId] = useState<string | null>(null); // если это мой канал (бот-админ)
  const [tiktok, setTiktok] = useState<string | null>(null);
  const [tiktokInput, setTiktokInput] = useState("");
  const [editTiktok, setEditTiktok] = useState(false);
  const [stats, setStats] = useState<{ favorites: number; privateFeeds: number; likesTotal: number; likesByLink: Record<string, number> } | null>(null);
  const { liked, toggle: toggleLike } = useLikes(!!session);

  async function loadMore() {
    if (!posts || posts.length === 0 || loadingMore) return;
    setLoadingMore(true);
    try {
      const before = Math.min(...posts.map((p) => p.msgId));
      const { posts: more } = await readChannelsBefore([{ channel: ch, before }]);
      const fresh = more.filter((m) => !posts.some((p) => p.msgId === m.msgId));
      if (fresh.length === 0) setNoMore(true);
      else fresh.forEach(mergePost);
    } finally {
      setLoadingMore(false);
    }
  }

  const mergePost = useCallback((p: Post) => {
    setPosts((prev) => {
      const arr = prev ? [...prev] : [];
      const key = (x: Post) => `${x.channel}/${x.msgId}`;
      const i = arr.findIndex((x) => key(x) === key(p));
      if (i >= 0) arr[i] = p; else arr.push(p);
      arr.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
      return [...arr];
    });
  }, []);

  useEffect(() => { if (ch) track("channel", ch); }, [ch]);

  useEffect(() => {
    setTiktok(null); setEditTiktok(false);
    channelLinks(ch).then((l) => { setTiktok(l.tiktok); setTiktokInput(l.tiktok ?? ""); }).catch(() => {});
  }, [ch]);

  async function saveTiktok() {
    if (!myChatId) return;
    try {
      const v = tiktokInput.trim() || null;
      await setChannelSocial(myChatId, v);
      setTiktok(v); setEditTiktok(false);
    } catch (e) { alert("Не удалось сохранить: " + (e as Error).message); }
  }

  useEffect(() => {
    channelsInfo([ch]).then((list) => setInfo(list[0] ?? { username: ch }));
    // Публичные ленты, в которых есть этот канал.
    loadPublic().then(({ feeds }) => {
      setInFeeds(feeds.filter((f) => f.channels.some((c) => normCh(c) === ch)));
    }).catch(() => setInFeeds([]));
    // Закреплённый в Telegram пост (для гостей — через MTProto).
    setPinned(null); setPinnedId(null); setPinText("");
    pinnedPost(ch).then((p) => { if (p) { setPinnedId((cur) => cur ?? p.msgId); setPinned((cur) => cur ?? p); } }).catch(() => {});
    // Если это мой канал (бот-админ) — включаем управление закреплением.
    setMyChatId(null);
    setStats(null);
    if (session) {
      // Пин-контролы — только для своего канала (бот-админ).
      authorChannels().then((chs) => {
        const mine = chs.find((c) => (c.username || "").toLowerCase() === ch);
        if (mine) setMyChatId(mine.chat_id);
      }).catch(() => {});
      // Статистику сервер отдаёт автору канала ИЛИ админу (иначе null).
      channelStats(ch).then(setStats).catch(() => {});
    }
  }, [ch, session]);

  // Для своего канала пин берём у бота (getChat) — он всегда знает актуальный пин.
  useEffect(() => {
    if (!myChatId) return;
    channelPinnedBot(myChatId).then((pin) => {
      if (!pin) { setPinnedId(null); setPinned(null); setPinText(""); return; }
      setPinnedId(pin.message_id); setPinText(pin.text || "");
    }).catch(() => {});
  }, [myChatId]);

  // Отображаемый закреп: если пост уже загружен в ленте — берём его (с медиа),
  // иначе строим минимальный из данных бота.
  useEffect(() => {
    if (pinnedId == null) return;
    const found = posts?.find((p) => p.msgId === pinnedId);
    if (found) setPinned(found);
    else setPinned((cur) => (cur && cur.msgId === pinnedId ? cur : {
      channel: ch, msgId: pinnedId, postedAt: new Date().toISOString(),
      text: pinText, hasMedia: false, media: [], link: `https://t.me/${ch}/${pinnedId}`,
    }));
  }, [pinnedId, posts, pinText, ch]);

  async function doPin(post: Post) {
    if (!myChatId) return;
    try { await pinPost(myChatId, post.msgId); setPinnedId(post.msgId); setPinned(post); }
    catch (e) { alert("Не удалось закрепить: " + (e as Error).message); }
  }
  async function doUnpin() {
    if (!myChatId || !pinned) return;
    try { await unpinPost(myChatId, pinned.msgId); setPinnedId(null); setPinned(null); }
    catch (e) { alert("Не удалось открепить: " + (e as Error).message); }
  }

  useEffect(() => {
    (async () => {
      setLoadingPosts(true);
      setPosts([]);
      // Сначала наш архив — он показывается мгновенно и переживает Telegram.
      // Медиа у архивных постов постоянные (наш Storage), поэтому живое чтение
      // НЕ перетираем архивными msgId.
      const arch = await archivedPosts(ch).catch(() => []);
      const archIds = new Set(arch.map((p) => p.msgId));
      arch.forEach(mergePost);
      try {
        const r = await readChannels([ch]);
        r.posts.filter((p) => !archIds.has(p.msgId)).forEach(mergePost);
        // Закрытый канал (защита от копирования) — только для вошедших.
        if (r.unavailable.includes(ch) && session) {
          const srv = await readChannelsMTServer([ch]);
          if (srv.posts.length) srv.posts.filter((p) => !archIds.has(p.msgId)).forEach(mergePost);
          else await readChannelsMT([ch], (p) => { if (!archIds.has(p.msgId)) mergePost(p); });
        }
      } catch { /* оставим что успели (хотя бы архив) */ }
      finally { setLoadingPosts(false); }
    })();
  }, [ch, session, mergePost]);

  useEffect(() => {
    if (session) favoriteLinks().then((l) => setFav(new Set(l)));
  }, [session]);

  async function toggleFav(post: Post) {
    const next = new Set(fav);
    if (next.has(post.link)) { next.delete(post.link); setFav(next); await removeFavorite(post.link); }
    else { next.add(post.link); setFav(next); await addFavorite(post); }
  }

  const title = info?.title || posts?.[0]?.channelTitle || `@${ch}`;
  const avatar = info?.avatar || posts?.[0]?.channelAvatar;

  return (
    <>
      <TopBar title={title} onBack={() => nav(-1)} />
      <div className="content">
        <div className="card">
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            {avatar ? (
              <img src={avatar} alt="" width={56} height={56} style={{ borderRadius: "50%", objectFit: "cover", border: "2px solid var(--ink)" }} />
            ) : (
              <div className="ava ava-ph" style={{ width: 56, height: 56 }}>@</div>
            )}
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{title}</div>
              <a className="muted" href={tgUrl(ch)} target="_blank" rel="noreferrer">@{ch}</a>
            </div>
          </div>
          {info?.description && <div className="post-text" style={{ marginTop: 10 }}>{linkify(info.description)}</div>}

          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <a className="btn secondary sm" href={tgUrl(ch)} target="_blank" rel="noreferrer">
              Открыть канал в Telegram ↗
            </a>
            {tiktok && (
              <a className="btn secondary sm tiktok-btn" href={tiktokHref(tiktok)} target="_blank" rel="noreferrer">
                <span aria-hidden>♪</span> TikTok {tiktokNick(tiktok)}
              </a>
            )}
            {myChatId && !editTiktok && (
              <button className="btn ghost sm" onClick={() => setEditTiktok(true)}>
                {tiktok ? "✎ TikTok" : "+ Ссылка на TikTok"}
              </button>
            )}
          </div>
          {myChatId && editTiktok && (
            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <input type="text" style={{ flex: "1 1 200px" }} placeholder="@ник или ссылка на TikTok"
                value={tiktokInput} onChange={(e) => setTiktokInput(e.target.value)} />
              <button className="btn sm" onClick={saveTiktok}>Сохранить</button>
              <button className="btn ghost sm" onClick={() => { setTiktokInput(tiktok ?? ""); setEditTiktok(false); }}>Отмена</button>
            </div>
          )}
          {stats && (
            <div className="chan-stats">
              <div className="chan-stat"><span className="chan-stat-num">{stats.likesTotal}</span><span className="chan-stat-lbl">лайков постов</span></div>
              <div className="chan-stat"><span className="chan-stat-num">{stats.favorites}</span><span className="chan-stat-lbl">постов в избранном</span></div>
              <div className="chan-stat"><span className="chan-stat-num">{stats.privateFeeds}</span><span className="chan-stat-lbl">в личных подборках</span></div>
              <div className="chan-stat-note">{myChatId ? "Видно вам как автору канала" : "Видно вам как администратору"}</div>
            </div>
          )}
        </div>

        {inFeeds.length > 0 && (
          <div className="card">
            <div className="muted" style={{ marginBottom: 6 }}>В подборках:</div>
            <div className="tags">
              {inFeeds.map((f) => (
                <Link key={f.id} to={`/feed/${f.id}`} className="tag">{f.title}</Link>
              ))}
            </div>
          </div>
        )}

        {pinned && (
          <div className="pinned-wrap">
            <div className="row spread" style={{ padding: "0 4px" }}>
              <span className="pinned-label">📌 Закреплено</span>
              {myChatId && <button className="btn ghost sm" onClick={doUnpin}>Открепить</button>}
            </div>
            <PostCard
              post={pinned}
              isFav={fav.has(pinned.link)}
              onToggleFav={session ? toggleFav : undefined}
              isLiked={liked.has(pinned.link)}
              onToggleLike={session ? toggleLike : undefined}
              likeCount={stats ? (stats.likesByLink[pinned.link] ?? 0) : undefined}
            />
          </div>
        )}

        {loadingPosts && (!posts || posts.length === 0) && <Loading label="Читаю канал…" />}
        {!loadingPosts && posts && posts.length === 0 && <Empty>Постов пока нет или превью канала недоступно.</Empty>}
        {posts?.filter((p) => !pinned || p.msgId !== pinned.msgId).map((p) => (
          <PostCard
            key={`${p.channel}/${p.msgId}`}
            post={p}
            isFav={fav.has(p.link)}
            onToggleFav={session ? toggleFav : undefined}
            onPin={myChatId ? doPin : undefined}
            isLiked={liked.has(p.link)}
            onToggleLike={session ? toggleLike : undefined}
            likeCount={stats ? (stats.likesByLink[p.link] ?? 0) : undefined}
          />
        ))}

        {posts && posts.length > 0 && !loadingPosts && (
          noMore ? (
            <div className="muted" style={{ textAlign: "center", padding: "14px 0" }}>Больше постов нет</div>
          ) : (
            <button className="btn secondary" style={{ margin: "8px auto", display: "block" }} onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Загружаю…" : "Ещё посты"}
            </button>
          )
        )}
      </div>
    </>
  );
}
