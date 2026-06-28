import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getFeedById, readChannels, readChannelsMT, readChannelsMTServer, favoriteLinks, addFavorite, removeFavorite, type Feed, type Post } from "../lib/data.ts";
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
  const [mtNote, setMtNote] = useState("");
  const [mtLoading, setMtLoading] = useState(false);
  const [openLoading, setOpenLoading] = useState(false);
  const [err, setErr] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Подмешивает пост в ленту без дублей, сохраняя сортировку по времени.
  const mergePost = useCallback((p: Post) => {
    setPosts((prev) => {
      const arr = prev ? [...prev] : [];
      const key = (x: Post) => `${x.channel}/${x.msgId}`;
      if (arr.some((x) => key(x) === key(p))) return arr;
      arr.push(p);
      arr.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
      return arr;
    });
  }, []);

  const load = useCallback(async () => {
    setErr("");
    setMtNote("");
    setPosts(null);
    setUnavailable([]);
    try {
      const f = await getFeedById(feedId);
      if (!f) throw new Error("лента не найдена или недоступна");
      setFeed(f);
      setPosts([]); // переходим в режим прогрессивной загрузки (посты подмешиваются)
      setOpenLoading(true);

      // Открытые каналы читаем ПАРАЛЛЕЛЬНО, по одному запросу на канал —
      // посты появляются по мере готовности, а не после самого медленного.
      const unavail: string[] = [];
      await Promise.all(
        f.channels.map(async (ch) => {
          try {
            const r = await readChannels([ch]);
            r.posts.forEach(mergePost);
            if (r.unavailable.length > 0) unavail.push(ch);
          } catch {
            unavail.push(ch);
          }
        }),
      );
      setOpenLoading(false);
      setUnavailable(unavail);

      // Закрытые каналы — сначала на сервере (без VPN). В браузер откатываемся
      // ТОЛЬКО если сервер реально не смог выполниться (иначе без VPN он зависнет).
      if (unavail.length > 0) {
        setMtLoading(true);
        const srv = await readChannelsMTServer(unavail);
        let result = srv;
        if (srv.posts && srv.posts.length > 0) {
          srv.posts.forEach(mergePost);
          setUnavailable(srv.unavailable);
        } else if (srv.error) {
          // Сервер упал (edge не тянет GramJS) — пробуем браузер (нужен VPN).
          const br = await readChannelsMT(srv.unavailable?.length ? srv.unavailable : unavail, mergePost);
          setUnavailable(br.unavailable);
          result = br;
        } else {
          setUnavailable(srv.unavailable);
        }
        setMtLoading(false);
        if (result.noAccount) setMtNote("Чтобы читать закрытые каналы, администратор должен подключить общий аккаунт (раздел «Аккаунт»).");
        else if (result.error) setMtNote("Чтение закрытых каналов: " + result.error);
        else if (result.note) setMtNote("Закрытые каналы: " + result.note);
      }
    } catch (e) {
      setMtLoading(false);
      setOpenLoading(false);
      setErr((e as Error).message);
    }
  }, [feedId, mergePost]);

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


        {mtLoading && (
          <div className="card" style={{ fontSize: 13 }}>
            Дочитываю закрытые каналы… посты появляются по мере загрузки (скачиваю медиа).
          </div>
        )}

        {!mtLoading && unavailable.length > 0 && (
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

        {!mtLoading && mtNote && <div className="card" style={{ fontSize: 13 }}>{mtNote}</div>}
        {err && <ErrorState message={err} onRetry={load} />}
        {!err && (!posts || (openLoading && posts.length === 0)) && <Loading label="Читаю каналы…" />}
        {posts && posts.length === 0 && !openLoading && !mtLoading && !err && <Empty>Постов пока нет.</Empty>}
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
