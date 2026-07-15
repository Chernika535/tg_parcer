import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  channelsInfo, readChannels, readChannelsMTServer, readChannelsMT, readChannelsBefore,
  loadPublic, favoriteLinks, addFavorite, removeFavorite, archivedPosts, channelLinks, setChannelSocial, uploadMedia,
  pinnedPost, pinPost, unpinPost, channelPinnedBot, authorChannels, channelStats, track,
  type Post, type ChannelInfo, type Feed, type ChannelSocials,
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
function youtubeHref(v: string): string {
  const raw = (v || "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://www.youtube.com/${raw.startsWith("@") ? raw : "@" + raw}`;
}
function youtubeLabel(v: string): string {
  const m = (v || "").match(/youtube\.com\/(@[^/?#]+)/i);
  if (m) return m[1];
  if ((v || "").trim().startsWith("@")) return v.trim();
  return "YouTube";
}
// Обычная внешняя ссылка (Bandlink/ЛитРес) — добавляем https:// если нет схемы.
function extHref(v: string): string {
  const raw = (v || "").trim();
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
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
  const emptySocials: ChannelSocials = { tiktok: null, youtube: null, bandlink: null, litres: null, boosty: null, vk: null, website: null, zen: null, rutube: null, teletype: null, pinterest: null, musicCaption: null, spotify: null, yandexmusic: null, zvuk: null, podcastUrl: null, podcastTitle: null, podcastCover: null };
  const [socials, setSocials] = useState<ChannelSocials>(emptySocials);
  const [editSocial, setEditSocial] = useState(false);
  const [sForm, setSForm] = useState({ tiktok: "", youtube: "", bandlink: "", litres: "", boosty: "", vk: "", website: "", zen: "", rutube: "", teletype: "", pinterest: "", musicCaption: "", spotify: "", yandexmusic: "", zvuk: "", podcastUrl: "", podcastTitle: "", podcastCover: "" });
  const [savingSocial, setSavingSocial] = useState(false);
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
    setSocials(emptySocials); setEditSocial(false);
    channelLinks(ch).then((l) => {
      setSocials(l);
      setSForm({ tiktok: l.tiktok ?? "", youtube: l.youtube ?? "", bandlink: l.bandlink ?? "", litres: l.litres ?? "", boosty: l.boosty ?? "", vk: l.vk ?? "", website: l.website ?? "", zen: l.zen ?? "", rutube: l.rutube ?? "", teletype: l.teletype ?? "", pinterest: l.pinterest ?? "", musicCaption: l.musicCaption ?? "", spotify: l.spotify ?? "", yandexmusic: l.yandexmusic ?? "", zvuk: l.zvuk ?? "", podcastUrl: l.podcastUrl ?? "", podcastTitle: l.podcastTitle ?? "", podcastCover: l.podcastCover ?? "" });
    }).catch(() => {});
  }, [ch]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pickPodcastCover(file: File) {
    setSavingSocial(true);
    try { const url = await uploadMedia(file, (file.name.split(".").pop() || "jpg")); setSForm((f) => ({ ...f, podcastCover: url })); }
    catch (e) { alert("Не удалось загрузить обложку: " + (e as Error).message); }
    finally { setSavingSocial(false); }
  }
  async function saveSocials() {
    if (!myChatId) return;
    setSavingSocial(true);
    try {
      await setChannelSocial(myChatId, {
        tiktok: sForm.tiktok, youtube: sForm.youtube, bandlink: sForm.bandlink, litres: sForm.litres,
        boosty: sForm.boosty, vk: sForm.vk, website: sForm.website,
        zen: sForm.zen, rutube: sForm.rutube, teletype: sForm.teletype, pinterest: sForm.pinterest,
        music_caption: sForm.musicCaption, spotify: sForm.spotify, yandexmusic: sForm.yandexmusic, zvuk: sForm.zvuk,
        podcast_url: sForm.podcastUrl, podcast_title: sForm.podcastTitle, podcast_cover: sForm.podcastCover,
      });
      setSocials({
        tiktok: sForm.tiktok.trim() || null, youtube: sForm.youtube.trim() || null,
        bandlink: sForm.bandlink.trim() || null, litres: sForm.litres.trim() || null,
        boosty: sForm.boosty.trim() || null, vk: sForm.vk.trim() || null, website: sForm.website.trim() || null,
        zen: sForm.zen.trim() || null, rutube: sForm.rutube.trim() || null, teletype: sForm.teletype.trim() || null, pinterest: sForm.pinterest.trim() || null,
        musicCaption: sForm.musicCaption.trim() || null, spotify: sForm.spotify.trim() || null, yandexmusic: sForm.yandexmusic.trim() || null, zvuk: sForm.zvuk.trim() || null,
        podcastUrl: sForm.podcastUrl.trim() || null, podcastTitle: sForm.podcastTitle.trim() || null,
        podcastCover: sForm.podcastCover.trim() || null,
      });
      setEditSocial(false);
    } catch (e) { alert("Не удалось сохранить: " + (e as Error).message); }
    finally { setSavingSocial(false); }
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

          <div className="link-hub">
            {([
              { key: "tg", href: tgUrl(ch), label: "Telegram", glyph: "✈" },
              socials.tiktok && { key: "tiktok", href: tiktokHref(socials.tiktok), label: `TikTok ${tiktokNick(socials.tiktok)}`, glyph: "♪" },
              socials.youtube && { key: "youtube", href: youtubeHref(socials.youtube), label: `YouTube ${youtubeLabel(socials.youtube)}`, glyph: "▶" },
              socials.bandlink && { key: "music", href: extHref(socials.bandlink), label: "Музыка", glyph: "🎧" },
              socials.litres && { key: "litres", href: extHref(socials.litres), label: "ЛитРес", glyph: "📚" },
              socials.boosty && { key: "boosty", href: extHref(socials.boosty), label: "Boosty", glyph: "🚀" },
              socials.vk && { key: "vk", href: extHref(socials.vk), label: "VK", glyph: "𝐕" },
              socials.zen && { key: "zen", href: extHref(socials.zen), label: "Дзен", glyph: "Ⓩ" },
              socials.rutube && { key: "rutube", href: extHref(socials.rutube), label: "Rutube", glyph: "▶" },
              socials.teletype && { key: "teletype", href: extHref(socials.teletype), label: "Teletype", glyph: "✎" },
              socials.pinterest && { key: "pinterest", href: extHref(socials.pinterest), label: "Pinterest", glyph: "📌" },
              socials.website && { key: "site", href: extHref(socials.website), label: "Сайт", glyph: "🌐" },
            ].filter(Boolean) as { key: string; href: string; label: string; glyph: string }[]).map((s) => (
              <a key={s.key} className={`link-pill brand-${s.key}`} href={s.href} target="_blank" rel="noreferrer">
                <span className="link-pill-ico" aria-hidden>{s.glyph}</span>{s.label}
              </a>
            ))}
            {myChatId && !editSocial && (
              <button className="link-pill link-pill-edit" onClick={() => setEditSocial(true)}>✎ Ссылки и подкаст</button>
            )}
          </div>

          {socials.podcastUrl && (
            <a className="podcast-card" href={socials.podcastUrl} target="_blank" rel="noreferrer">
              {socials.podcastCover
                ? <img src={socials.podcastCover} alt="" className="podcast-cover" />
                : <span className="podcast-cover podcast-cover-ph">🎙</span>}
              <span className="podcast-body">
                <span className="podcast-kicker">🎙 Подкаст</span>
                <span className="podcast-title">{socials.podcastTitle || "Слушать подкаст"}</span>
              </span>
              <span className="podcast-go" aria-hidden>↗</span>
            </a>
          )}

          {(socials.musicCaption || socials.spotify || socials.yandexmusic || socials.zvuk) && (
            <div className="music-block">
              <div className="music-head">🎵 {socials.musicCaption || "Моя музыка"}</div>
              <div className="music-links">
                {socials.spotify && <a className="music-pill brand-spotify" href={extHref(socials.spotify)} target="_blank" rel="noreferrer">Spotify</a>}
                {socials.yandexmusic && <a className="music-pill brand-yamusic" href={extHref(socials.yandexmusic)} target="_blank" rel="noreferrer">Яндекс Музыка</a>}
                {socials.zvuk && <a className="music-pill brand-zvuk" href={extHref(socials.zvuk)} target="_blank" rel="noreferrer">Звук</a>}
              </div>
            </div>
          )}

          {myChatId && editSocial && (
            <div className="social-edit">
              <div className="field"><label>TikTok (@ник или ссылка)</label>
                <input type="text" value={sForm.tiktok} onChange={(e) => setSForm((f) => ({ ...f, tiktok: e.target.value }))} placeholder="@oba_vsem" /></div>
              <div className="field"><label>YouTube (@ник или ссылка)</label>
                <input type="text" value={sForm.youtube} onChange={(e) => setSForm((f) => ({ ...f, youtube: e.target.value }))} placeholder="@obavsem или ссылка" /></div>
              <div className="field"><label>Bandlink (музыка) — ссылка</label>
                <input type="text" value={sForm.bandlink} onChange={(e) => setSForm((f) => ({ ...f, bandlink: e.target.value }))} placeholder="band.link/... или ссылка" /></div>
              <div className="field"><label>ЛитРес (книги) — ссылка</label>
                <input type="text" value={sForm.litres} onChange={(e) => setSForm((f) => ({ ...f, litres: e.target.value }))} placeholder="litres.ru/author/... или ссылка" /></div>
              <div className="field"><label>Boosty — ссылка</label>
                <input type="text" value={sForm.boosty} onChange={(e) => setSForm((f) => ({ ...f, boosty: e.target.value }))} placeholder="boosty.to/..." /></div>
              <div className="field"><label>VK — ссылка</label>
                <input type="text" value={sForm.vk} onChange={(e) => setSForm((f) => ({ ...f, vk: e.target.value }))} placeholder="vk.com/..." /></div>
              <div className="field"><label>Личный сайт — ссылка</label>
                <input type="text" value={sForm.website} onChange={(e) => setSForm((f) => ({ ...f, website: e.target.value }))} placeholder="example.com" /></div>
              <div className="field"><label>Дзен — ссылка</label>
                <input type="text" value={sForm.zen} onChange={(e) => setSForm((f) => ({ ...f, zen: e.target.value }))} placeholder="dzen.ru/..." /></div>
              <div className="field"><label>Rutube — ссылка</label>
                <input type="text" value={sForm.rutube} onChange={(e) => setSForm((f) => ({ ...f, rutube: e.target.value }))} placeholder="rutube.ru/channel/..." /></div>
              <div className="field"><label>Teletype — ссылка</label>
                <input type="text" value={sForm.teletype} onChange={(e) => setSForm((f) => ({ ...f, teletype: e.target.value }))} placeholder="teletype.in/@..." /></div>
              <div className="field"><label>Pinterest — ссылка</label>
                <input type="text" value={sForm.pinterest} onChange={(e) => setSForm((f) => ({ ...f, pinterest: e.target.value }))} placeholder="pinterest.com/..." /></div>

              <div style={{ borderTop: "1px solid var(--surface-2)", margin: "10px 0 6px", paddingTop: 8, fontWeight: 800 }}>🎵 Музыкальный блок</div>
              <div className="field"><label>Подпись (например: «Плейлист, который меня отражает»)</label>
                <input type="text" value={sForm.musicCaption} onChange={(e) => setSForm((f) => ({ ...f, musicCaption: e.target.value }))} placeholder="Что я слушаю" /></div>
              <div className="field"><label>Spotify — ссылка на трек/плейлист</label>
                <input type="text" value={sForm.spotify} onChange={(e) => setSForm((f) => ({ ...f, spotify: e.target.value }))} placeholder="open.spotify.com/..." /></div>
              <div className="field"><label>Яндекс Музыка — ссылка</label>
                <input type="text" value={sForm.yandexmusic} onChange={(e) => setSForm((f) => ({ ...f, yandexmusic: e.target.value }))} placeholder="music.yandex.ru/..." /></div>
              <div className="field"><label>Звук — ссылка</label>
                <input type="text" value={sForm.zvuk} onChange={(e) => setSForm((f) => ({ ...f, zvuk: e.target.value }))} placeholder="zvuk.com/..." /></div>

              <div className="field"><label>Подкаст — ссылка</label>
                <input type="text" value={sForm.podcastUrl} onChange={(e) => setSForm((f) => ({ ...f, podcastUrl: e.target.value }))} placeholder="https://oba-vsem.mave.digital/" /></div>
              <div className="field"><label>Подкаст — название</label>
                <input type="text" value={sForm.podcastTitle} onChange={(e) => setSForm((f) => ({ ...f, podcastTitle: e.target.value }))} placeholder="Оба всем" /></div>
              <div className="field"><label>Подкаст — обложка (маленькая)</label>
                <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {sForm.podcastCover && <img src={sForm.podcastCover} alt="" className="podcast-cover" />}
                  <label className="btn secondary sm" style={{ cursor: "pointer" }}>
                    {savingSocial ? "…" : sForm.podcastCover ? "Заменить" : "Загрузить"}
                    <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && pickPodcastCover(e.target.files[0])} />
                  </label>
                  {sForm.podcastCover && <button className="btn ghost sm" onClick={() => setSForm((f) => ({ ...f, podcastCover: "" }))}>Убрать</button>}
                </div>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 4 }}>
                <button className="btn sm" onClick={saveSocials} disabled={savingSocial}>{savingSocial ? "Сохранение…" : "Сохранить"}</button>
                <button className="btn ghost sm" onClick={() => setEditSocial(false)}>Отмена</button>
              </div>
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
