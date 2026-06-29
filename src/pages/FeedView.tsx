import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getFeedById, readChannels, readChannelsMT, readChannelsMTServer, favoriteLinks, addFavorite, removeFavorite, type Feed, type Post } from "../lib/data.ts";
import { useAuth } from "../lib/auth.tsx";
import { Loading, ErrorState, Empty, TopBar } from "../components/States.tsx";
import PostCard from "../components/PostCard.tsx";

// Кэш постов по ленте: в памяти (полный, с blob/data медиа) + в localStorage
// (облегчённый, для мгновенного показа между сессиями).
const feedCache = new Map<number, Post[]>();

// blob:/data: ссылки живут только в текущей вкладке — после перезагрузки мертвы.
// Поэтому и при сохранении, и при чтении кэша их выкидываем (иначе «битые» фото).
const isDeadUrl = (u?: string) => !!u && (u.startsWith("blob:") || u.startsWith("data:"));
function sanitize(posts: Post[]): Post[] {
  return posts.map((p) => ({
    ...p,
    channelAvatar: isDeadUrl(p.channelAvatar) ? undefined : p.channelAvatar,
    media: p.media.filter((m) => {
      const u = (m as { url?: string; thumb?: string; image?: string }).url
        || (m as { thumb?: string }).thumb || (m as { image?: string }).image || "";
      return !isDeadUrl(u);
    }),
  }));
}

function loadPersisted(id: number): Post[] | null {
  try {
    const s = localStorage.getItem("tf_feed_" + id);
    return s ? sanitize(JSON.parse(s) as Post[]) : null;
  } catch {
    return null;
  }
}
function persist(id: number, posts: Post[]) {
  try {
    localStorage.setItem("tf_feed_" + id, JSON.stringify(sanitize(posts).slice(0, 40)));
  } catch {
    /* квота/приватный режим — не критично */
  }
}

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

  // Подмешивает/обновляет пост в ленте (upsert по channel/msgId), сохраняя
  // сортировку. Позволяет показать текст сразу, а медиа дослать позже.
  const mergePost = useCallback((p: Post) => {
    setPosts((prev) => {
      const arr = prev ? [...prev] : [];
      const key = (x: Post) => `${x.channel}/${x.msgId}`;
      const i = arr.findIndex((x) => key(x) === key(p));
      if (i >= 0) arr[i] = p;
      else arr.push(p);
      arr.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
      return [...arr];
    });
  }, []);

  const load = useCallback(async () => {
    setErr("");
    setMtNote("");
    // Если есть кэш — показываем его сразу и обновляем в фоне (без большого спиннера).
    const cached = feedCache.get(feedId) ?? loadPersisted(feedId);
    if (cached && cached.length) {
      setPosts(cached);
      setOpenLoading(false);
    } else {
      setPosts(null);
      setUnavailable([]);
    }
    try {
      const f = await getFeedById(feedId);
      if (!f) throw new Error("лента не найдена или недоступна");
      setFeed(f);
      if (!cached || !cached.length) {
        setPosts([]); // прогрессивная загрузка (посты подмешиваются)
        setOpenLoading(true);
      }

      // Открытые каналы — ОДНИМ запросом (сервер сам читает их параллельно).
      // Так один холодный старт функции вместо 12 — заметно быстрее и надёжнее.
      let unavail: string[] = [];
      try {
        const r = await readChannels(f.channels);
        r.posts.forEach(mergePost);
        unavail = r.unavailable;
      } catch (e) {
        // Если открытые не прочитались — не валим всю ленту, помечаем все каналы.
        unavail = f.channels;
        setMtNote("Не удалось прочитать каналы: " + (e as Error).message);
      }
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
        } else if (!srv.noAccount) {
          // Сервер не дал постов (упал / пусто) — пробуем браузер (нужен VPN).
          const br = await readChannelsMT(srv.unavailable?.length ? srv.unavailable : unavail, mergePost);
          setUnavailable(br.unavailable);
          // Если браузер тоже не дал постов — показываем причину сервера (важнее
          // для диагностики: работает ли чтение закрытых каналов на сервере).
          result = br.posts.length > 0 ? br : { ...br, error: srv.error || br.error, note: srv.note || br.note };
        } else {
          setUnavailable(srv.unavailable);
        }
        setMtLoading(false);
        if (result.noAccount) setMtNote("Чтобы читать закрытые каналы, администратор должен подключить общий аккаунт (раздел «Аккаунт»).");
        else if (result.error) setMtNote("Чтение закрытых каналов (сервер): " + result.error);
        else if (result.note) setMtNote("Закрытые каналы: " + result.note);
      }
      // Сохраняем итог в кэш для мгновенного повторного открытия.
      setPosts((p) => {
        if (p && p.length) {
          feedCache.set(feedId, p);
          persist(feedId, p);
        }
        return p;
      });
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
