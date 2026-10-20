import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getFeedById, readChannels, readChannelsMT, readChannelsMTServer, readChannelsBefore, favoriteLinks, addFavorite, removeFavorite, channelsInfo, cacheFeedMeta, feedPreview, cloneFeed, updateFeed, track, type Feed, type Post, type ChannelInfo, type FeedPreview } from "../lib/data.ts";
import { useAuth } from "../lib/auth.tsx";
import { Loading, ErrorState, Empty, TopBar } from "../components/States.tsx";
import PostCard from "../components/PostCard.tsx";
import { shareLink, feedUrl } from "../lib/share.ts";
import { linkify, plainPreview } from "../lib/linkify.tsx";
import { useLikes } from "../lib/useLikes.ts";
import { isAdultAllowed, confirmAdult } from "../lib/adult.ts";
import GuestBanner from "../components/GuestBanner.tsx";

// Кэш постов по ленте: в памяти (полный, с blob/data медиа) + в localStorage
// (облегчённый, для мгновенного показа между сессиями).
const feedCache = new Map<number, Post[]>();

// Кэш самой ленты (название, описание, каналы) — чтобы при сбое сети не мигало
// «лента не найдена» и не пропадали описание/состав.
const feedMetaCache = new Map<number, Feed>();
function loadFeedMeta(id: number): Feed | null {
  if (feedMetaCache.has(id)) return feedMetaCache.get(id)!;
  try { const s = localStorage.getItem("tf_feedmeta_" + id); return s ? (JSON.parse(s) as Feed) : null; } catch { return null; }
}
function saveFeedMeta(f: Feed) {
  feedMetaCache.set(f.id, f);
  cacheFeedMeta(f);
}

// Нормализуем ник канала для сравнения (лента может хранить @Name / ссылку).
function normCh(c: string): string {
  return c.trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^t\.me\//, "").replace(/^s\//, "").replace(/^@/, "")
    .split(/[/?#]/)[0].replace(/[^a-z0-9_]/g, "");
}

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
  const { session, profile } = useAuth();
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [renderLimit, setRenderLimit] = useState(15); // окно рендера постов (перф)
  const { liked, toggle: toggleLike } = useLikes(!!session);
  const [fav, setFav] = useState<Set<string>>(new Set());
  const [feed, setFeed] = useState<Feed | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [mtNote, setMtNote] = useState("");
  const [mtLoading, setMtLoading] = useState(false);
  const [openLoading, setOpenLoading] = useState(false);
  const [err, setErr] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [noMore, setNoMore] = useState(false);
  const [showChannels, setShowChannels] = useState(false);
  const [chanInfo, setChanInfo] = useState<ChannelInfo[] | null>(null);
  const [chanLoading, setChanLoading] = useState(false);
  const [preview, setPreview] = useState<FeedPreview | null>(null); // чужая лента по ссылке
  const [cloning, setCloning] = useState(false);
  const [removingCh, setRemovingCh] = useState<string | null>(null);

  // Убрать канал из ЛИЧНОЙ ленты (снять галочку). Обновляем ленту и показ.
  async function removeChannel(username: string) {
    if (!feed || feed.visibility !== "private") return;
    setRemovingCh(username);
    try {
      const nextChannels = feed.channels.filter((c) => normCh(c) !== normCh(username));
      await updateFeed(feed.id, { channels: nextChannels });
      const nf = { ...feed, channels: nextChannels };
      setFeed(nf); saveFeedMeta(nf);
      setChanInfo((prev) => (prev ? prev.filter((c) => normCh(c.username) !== normCh(username)) : prev));
      setPosts((prev) => (prev ? prev.filter((p) => normCh(p.channel) !== normCh(username)) : prev));
    } catch (e) {
      setErr("Не удалось убрать канал: " + (e as Error).message);
    } finally {
      setRemovingCh(null);
    }
  }

  // Раскрытие состава ленты («Подробнее») — подтягиваем инфо о каналах лениво.
  async function toggleChannels() {
    const next = !showChannels;
    setShowChannels(next);
    if (next && !chanInfo && feed && feed.channels.length) {
      setChanLoading(true);
      const list = await channelsInfo(feed.channels);
      const byName = new Map(list.map((c) => [c.username.toLowerCase(), c]));
      // Название/аватар каналов без публичного превью берём из УЖЕ загруженных
      // постов (они несут channelTitle/channelAvatar) — без лишних запросов.
      const byPost = new Map<string, { title?: string; avatar?: string }>();
      for (const p of posts ?? []) {
        const k = normCh(p.channel);
        if (!byPost.has(k) && (p.channelTitle || p.channelAvatar)) {
          byPost.set(k, { title: p.channelTitle, avatar: p.channelAvatar });
        }
      }
      setChanInfo(feed.channels.map((c) => {
        const u = normCh(c);
        const info = byName.get(u);
        if (info && (info.title || info.avatar)) return info;
        const pi = byPost.get(u);
        return { username: u, title: pi?.title, avatar: pi?.avatar };
      }));
      setChanLoading(false);
    }
  }

  const GUEST_MSG = "Чтобы читать каналы, контент которых защищён от копирования, вам необходимо войти в свой аккаунт. Для гостей доступны только каналы с публичными превью.";

  // Подмешивает/обновляет пост в ленте (upsert по channel/msgId), сохраняя
  // сортировку. Позволяет показать текст сразу, а медиа дослать позже.
  const mergePost = useCallback((p: Post) => {
    setPosts((prev) => {
      const arr = prev ? [...prev] : [];
      // Ключ по НОРМАЛИЗОВАННОМУ нику — иначе один и тот же пост, пришедший из
      // разных источников с разным регистром ника (t.me/s / MTProto / кэш),
      // добавлялся дважды (дубли, особенно у постов с фото).
      const key = (x: Post) => `${normCh(x.channel)}/${x.msgId}`;
      const i = arr.findIndex((x) => key(x) === key(p));
      if (i >= 0) arr[i] = p;
      else arr.push(p);
      arr.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
      return [...arr];
    });
  }, []);

  // Чтение закрытых каналов: сначала сервер (read-mt, сессия service-role,
  // работает и без VPN), затем браузер (GramJS, нужен VPN) для тех, что не вышли.
  const readClosed = useCallback(
    async (chs: string[]): Promise<{ unavailable: string[]; note?: string; noAccount?: boolean; error?: string }> => {
      const srv = await readChannelsMTServer(chs);
      if (srv.posts && srv.posts.length > 0) srv.posts.forEach(mergePost);
      const left = srv.posts && srv.posts.length > 0 ? srv.unavailable ?? [] : chs;
      // Причину серверного чтения (srv) показываем В ПЕРВУЮ очередь — именно оно
      // должно работать без VPN; ошибка браузера (нет VPN) не должна её маскировать.
      const srvReason = srv.error || srv.note;
      if (left.length === 0) return { unavailable: [], note: srvReason };
      // Остаток (или всё, если сервер пуст) — пробуем в браузере.
      const br = await readChannelsMT(left, mergePost);
      return {
        unavailable: br.unavailable,
        note: srvReason ? "Сервер: " + srvReason : (br.note || br.error),
        noAccount: br.noAccount && srv.noAccount,
        error: br.error || srv.error,
      };
    },
    [mergePost],
  );

  // Повторная попытка по одному каналу (кнопка ↻ у недоступного канала).
  const retryChannel = useCallback(
    async (ch: string) => {
      setRetrying(ch);
      try {
        const r = await readClosed([ch]);
        setUnavailable((prev) => prev.filter((c) => (c === ch ? r.unavailable.includes(ch) : true)));
      } finally {
        setRetrying(null);
      }
    },
    [readClosed],
  );

  // «Ещё посты»: для каждого канала берём самый старый показанный msgId и грузим
  // окно старше него. Работает для открытых каналов (t.me/s ?before=).
  async function loadMore() {
    if (!posts || posts.length === 0 || loadingMore) return;
    setLoadingMore(true);
    try {
      const oldest = new Map<string, number>();
      for (const p of posts) {
        const c = normCh(p.channel);
        const m = oldest.get(c);
        if (m === undefined || p.msgId < m) oldest.set(c, p.msgId);
      }
      const cursors = [...oldest.entries()].map(([channel, before]) => ({ channel, before }));
      const { posts: more } = await readChannelsBefore(cursors);
      const fresh = more.filter((m) => !posts.some((p) => normCh(p.channel) === normCh(m.channel) && p.msgId === m.msgId));
      if (fresh.length === 0) setNoMore(true);
      else fresh.forEach(mergePost);
    } finally {
      setLoadingMore(false);
    }
  }

  const load = useCallback(async (forceFresh = false) => {
    setErr("");
    setMtNote("");
    setPreview(null);
    setNoMore(false);
    setShowChannels(false);
    setChanInfo(null);
    // Если есть кэш — показываем его сразу и обновляем в фоне (без большого спиннера).
    const cached = feedCache.get(feedId) ?? loadPersisted(feedId);
    if (cached && cached.length) {
      setPosts(cached);
      setOpenLoading(false);
    } else {
      setPosts(null);
      setUnavailable([]);
    }
    // Показываем кэшированную ленту сразу (название/описание/состав).
    const cachedMeta = loadFeedMeta(feedId);
    if (cachedMeta) setFeed(cachedMeta);
    try {
      const fresh = await getFeedById(feedId);
      // Сеть подвела, но кэш есть — работаем на кэше, без пугающей ошибки.
      const f = fresh ?? cachedMeta;
      if (!f) {
        // Не своя/непубличная лента по ссылке — показываем превью с «Добавить себе».
        const pv = await feedPreview(feedId);
        if (pv) { setPreview(pv); setOpenLoading(false); return; }
        throw new Error("лента не найдена или недоступна");
      }
      setFeed(f);
      if (fresh) saveFeedMeta(fresh);
      // Убираем из показа посты каналов, которых больше нет в ленте (после удаления канала).
      const chan = new Set(f.channels.map(normCh));
      setPosts((prev) => (prev ? prev.filter((p) => chan.has(normCh(p.channel))) : prev));
      if (!cached || !cached.length) {
        setPosts([]); // прогрессивная загрузка (посты подмешиваются)
        setOpenLoading(true);
      }

      // Открытые каналы — ОДНИМ запросом (сервер сам читает их параллельно).
      // Так один холодный старт функции вместо 12 — заметно быстрее и надёжнее.
      let unavail: string[] = [];
      try {
        const r = await readChannels(f.channels, { fresh: forceFresh });
        r.posts.forEach(mergePost);
        unavail = r.unavailable;
      } catch (e) {
        // Если открытые не прочитались — не валим всю ленту, помечаем все каналы.
        unavail = f.channels;
        setMtNote("Не удалось прочитать каналы: " + (e as Error).message);
      }
      setOpenLoading(false);
      setUnavailable(unavail);

      // Закрытые каналы (защита от копирования) — только для вошедших.
      if (unavail.length > 0) {
        if (!session) {
          setUnavailable(unavail);
          setMtNote(GUEST_MSG);
        } else {
          setMtLoading(true);
          const r = await readClosed(unavail);
          setUnavailable(r.unavailable);
          setMtLoading(false);
          if (r.noAccount) setMtNote("Общий читающий аккаунт не подключён — это делает администратор в разделе «Аккаунт».");
          else if (r.error) setMtNote("Закрытые каналы: " + r.error);
          else if (r.note) setMtNote("Закрытые каналы — " + r.note);
        }
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
  }, [feedId, mergePost, session, readClosed]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (session) favoriteLinks().then((l) => setFav(new Set(l)));
  }, [session]);

  useEffect(() => {
    if (Number.isFinite(feedId)) track("feed", String(feedId));
  }, [feedId]);

  // Запоминаем позицию прокрутки ленты и восстанавливаем при возврате (со
  // свёрнутой вкладки/после перезагрузки), чтобы не начинать сверху.
  const restoredRef = useRef(false);
  useEffect(() => { restoredRef.current = false; setRenderLimit(15); }, [feedId]);
  useEffect(() => {
    // Сохраняем позицию прокрутки и постепенно доращиваем окно рендера у низа
    // страницы (иначе на больших лентах в DOM висят сотни карточек — тормозит).
    const onScroll = () => {
      try { sessionStorage.setItem("tf_scroll_" + feedId, String(window.scrollY)); } catch { /* ignore */ }
      if (window.scrollY + window.innerHeight > document.body.scrollHeight - 1500) {
        setRenderLimit((n) => n + 15);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [feedId]);
  useEffect(() => {
    if (restoredRef.current || !posts || posts.length === 0) return;
    let y = 0;
    try { y = Number(sessionStorage.getItem("tf_scroll_" + feedId) || 0); } catch { /* ignore */ }
    restoredRef.current = true;
    if (y <= 0) return;
    // Доращиваем окно, чтобы хватило контента до сохранённой позиции, и один раз
    // прокручиваем к ней (без навязчивого «подталкивания» — оно дёргало страницу).
    setRenderLimit((n) => Math.max(n, Math.ceil(y / 220) + 15));
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [posts, feedId]);

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
    await load(true); // кнопка «обновить» — берём свежие посты в обход кэша
    setRefreshing(false);
  }

  async function doClone() {
    if (!preview) return;
    if (!session) { nav("/login"); return; }
    setCloning(true);
    try {
      const created = await cloneFeed(preview.id);
      nav(`/feed/${created.id}`);
    } catch (e) {
      setErr("Не удалось добавить: " + (e as Error).message);
    } finally {
      setCloning(false);
    }
  }

  // Экран «чужая лента по ссылке» — превью + «Добавить себе».
  if (preview) {
    return (
      <>
        <TopBar title={preview.title || "Лента"} onBack={() => nav(-1)} />
        <div className="content">
          <div className="card">
            <div style={{ fontFamily: "var(--head)", fontWeight: 800, fontSize: 20 }}>{preview.title}</div>
            {preview.author_name && <div className="muted" style={{ marginTop: 4 }}>от {preview.author_name}</div>}
            {preview.description && <div className="post-text" style={{ marginTop: 10 }}>{linkify(preview.description)}</div>}
            {preview.tags.length > 0 && (
              <div className="tags" style={{ marginTop: 10 }}>
                {preview.tags.map((t) => <span key={t} className="chip">#{t}</span>)}
              </div>
            )}
            <div className="muted" style={{ fontSize: 13, marginTop: 12, marginBottom: 4 }}>Каналы ({preview.channels.length}):</div>
            <div className="tags">
              {preview.channels.map((c) => <span key={c} className="tag">@{normCh(c)}</span>)}
            </div>
            <button className="btn" style={{ marginTop: 16 }} onClick={doClone} disabled={cloning}>
              {cloning ? "Добавляю…" : "➕ Добавить себе"}
            </button>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Появится точно такая же лента в разделе «Мои» — приватная, только для вас.
            </div>
            {err && <div className="muted" style={{ fontSize: 12, color: "var(--pink)", marginTop: 6 }}>{err}</div>}
          </div>
        </div>
      </>
    );
  }

  const adultBlocked = !!feed?.adult && !ageConfirmed && !isAdultAllowed(profile?.birth_date);

  return (
    <>
      <TopBar title={feed?.title || "Лента"} onBack={() => nav(-1)} />
      <div className="content">
        {!session && <GuestBanner />}
        {(feed?.description || feed?.author_name) && (
          <div className="card post-text" style={{ padding: 14 }}>
            {feed?.description && linkify(feed.description)}
            {feed?.author_name && (
              <div className="feed-author">от {feed.author_name}</div>
            )}
          </div>
        )}

        {feed && feed.channels.length > 0 && (
          <div className="card" style={{ padding: 14 }}>
            <button className="btn ghost sm" onClick={toggleChannels} style={{ padding: 0 }}>
              {showChannels ? "Свернуть ▲" : `Подробнее: каналы (${feed.channels.length}) ▾`}
            </button>
            {showChannels && (
              <div style={{ marginTop: 10 }}>
                {chanLoading && !chanInfo && <div className="muted">Загружаю список каналов…</div>}
                {chanInfo?.map((c) => (
                  <div key={c.username} className="chan-row-wrap">
                    <Link to={`/channel/${c.username}`} className="chan-row">
                      {c.avatar ? (
                        <img src={c.avatar} alt="" width={40} height={40} className="chan-ava" />
                      ) : (
                        <div className="ava ava-ph" style={{ width: 40, height: 40 }}>@</div>
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700 }}>{c.title || `@${c.username}`}</div>
                        <div className="muted" style={{ fontSize: 12 }}>@{c.username}</div>
                        {plainPreview(c.description) && <div className="muted chan-desc">{plainPreview(c.description)}</div>}
                      </div>
                    </Link>
                    {feed?.visibility === "private" && (
                      <button className="chan-remove" title="Убрать из ленты" disabled={removingCh === c.username}
                        onClick={() => removeChannel(c.username)}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="row spread">
          <span className="muted">{feed ? `${feed.channels.length} каналов` : ""}</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost sm" onClick={() => shareLink(feedUrl(feedId), feed?.title)}>
              ↗ Поделиться
            </button>
            <button className="btn ghost sm" onClick={refresh} disabled={refreshing}>
              {refreshing ? "Обновление…" : "↻ Обновить"}
            </button>
          </div>
        </div>


        {adultBlocked ? (
          <div className="card adult-gate">
            <div style={{ fontSize: 40, lineHeight: 1 }}>🔞</div>
            <div style={{ fontWeight: 800, marginTop: 8 }}>Контент 18+</div>
            <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
              Данная подборка может содержать контент для взрослых или нецензурную лексику. Подтвердите, что вам есть 18 лет.
            </p>
            <button className="btn" style={{ marginTop: 6 }} onClick={() => { confirmAdult(); setAgeConfirmed(true); }}>
              Мне есть 18 лет
            </button>
            <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => nav(-1)}>Назад</button>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Чтобы не подтверждать каждый раз, укажите дату рождения в разделе «Аккаунт».
            </p>
          </div>
        ) : (<>
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
                  @{c}
                  {session && (
                    <button
                      className="btn ghost sm"
                      style={{ marginLeft: 6, padding: "2px 8px" }}
                      onClick={() => retryChannel(c)}
                      disabled={retrying === c}
                    >
                      {retrying === c ? "…" : "↻ ещё раз"}
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {!mtLoading && mtNote && <div className="card" style={{ fontSize: 13 }}>{mtNote}</div>}
        {err && <ErrorState message={err} onRetry={load} />}
        {!err && (!posts || (openLoading && posts.length === 0)) && <Loading label="Читаю каналы…" />}
        {posts && posts.length === 0 && !openLoading && !mtLoading && !err && <Empty>Постов пока нет.</Empty>}
        {posts?.slice(0, renderLimit).map((p) => (
          <PostCard
            key={`${p.channel}/${p.msgId}`}
            post={p}
            feedId={feedId}
            isFav={fav.has(p.link)}
            onToggleFav={session ? toggleFav : undefined}
            isLiked={liked.has(p.link)}
            onToggleLike={session ? toggleLike : undefined}
          />
        ))}

        {posts && renderLimit < posts.length && (
          <button className="btn secondary" style={{ margin: "8px auto", display: "block" }} onClick={() => setRenderLimit((n) => n + 15)}>
            Показать ещё
          </button>
        )}

        {posts && posts.length > 0 && renderLimit >= posts.length && !openLoading && !mtLoading && (
          noMore ? (
            <div className="muted" style={{ textAlign: "center", padding: "14px 0" }}>Больше постов нет</div>
          ) : (
            <button className="btn secondary" style={{ margin: "8px auto", display: "block" }} onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Загружаю…" : "Ещё посты"}
            </button>
          )
        )}
        </>)}
      </div>
    </>
  );
}
