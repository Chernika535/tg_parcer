import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Post, Media } from "../lib/data.ts";
import { loadPostMedia, track } from "../lib/data.ts";
import Icon from "./Icon.tsx";
import { shareLink, postUrl } from "../lib/share.ts";
import AddChannelButton from "./AddChannelButton.tsx";
import Lightbox from "./Lightbox.tsx";

// Тело поста: готовый безопасный HTML (форматирование Telegram сохранено на
// стороне парсера). Длинный текст сворачиваем по высоте, спойлеры — по клику.
function PostText({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !expanded) setOverflow(el.scrollHeight > el.clientHeight + 4);
  }, [html, expanded]);
  return (
    <>
      <div
        ref={ref}
        className={`post-text ${expanded ? "" : "clamp"}`}
        onClick={(e) => {
          const t = (e.target as HTMLElement).closest(".tg-spoiler");
          if (t) t.classList.toggle("revealed");
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {(overflow || expanded) && (
        <button className="btn ghost sm" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Свернуть" : "Показать ещё"}
        </button>
      )}
    </>
  );
}

// Компактная дата-время публикации: «05.07.26 в 12:23».
function shortDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)} в ${p(d.getHours())}:${p(d.getMinutes())}`;
}


// Добавляет «кэш-бастер» к http-адресу, чтобы повтор реально перезапросил файл.
function bust(url: string, n: number): string {
  if (n === 0 || url.startsWith("blob:") || url.startsWith("data:")) return url;
  return url + (url.includes("?") ? "&" : "?") + "_r=" + n;
}

// Картинка с кнопкой «↻ Загрузить» при ошибке (медиа из Telegram бывает не докачивается).
function RImg({ src, className }: { src: string; className?: string }) {
  const [n, setN] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <button
        type="button"
        className={`media-retry ${className ?? ""}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFailed(false); setN((x) => x + 1); }}
        title="Загрузить ещё раз"
      >↻</button>
    );
  }
  return <img className={className} alt="" loading="lazy" src={bust(src, n)} onError={() => setFailed(true)} />;
}

function RVideo({ url, thumb, round }: { url: string; thumb?: string; round?: boolean }) {
  const [n, setN] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <button type="button" className="media-retry block" onClick={() => { setFailed(false); setN((x) => x + 1); }}>
        ↻ Видео не загрузилось — повторить
      </button>
    );
  }
  if (round) return <RoundVideo src={bust(url, n)} thumb={thumb ? bust(thumb, n) : undefined} onError={() => setFailed(true)} />;
  return (
    <video
      className="media-video"
      src={bust(url, n)}
      poster={thumb ? bust(thumb, n) : undefined}
      controls
      playsInline
      preload="metadata"
      onError={() => setFailed(true)}
    />
  );
}

// Кружок в ленте: как в Telegram — крутится без звука, тап включает звук,
// повторный тап ставит на паузу. Никаких крупных элементов поверх лица.
function RoundVideo({ src, thumb, onError }: { src: string; thumb?: string; onError?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(true);
  function toggle() {
    const v = ref.current;
    if (!v) return;
    if (muted) { v.muted = false; setMuted(false); if (v.paused) v.play().catch(() => {}); return; }
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }
  return (
    <div className="round-video" onClick={toggle}>
      <video
        ref={ref} src={src} poster={thumb}
        autoPlay muted loop playsInline preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onError={onError}
      />
      {!playing && <span className="rv-play" aria-hidden>▶</span>}
      <button className="rv-mute" onClick={(e) => { e.stopPropagation(); const v = ref.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted); if (!v.muted && v.paused) v.play().catch(() => {}); }} aria-label={muted ? "Включить звук" : "Выключить звук"}>
        {muted ? "🔇" : "🔊"}
      </button>
    </div>
  );
}

function RAudio({ url }: { url: string }) {
  const [n, setN] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <button type="button" className="media-retry block" onClick={() => { setFailed(false); setN((x) => x + 1); }}>
        ↻ Голосовое не загрузилось — повторить
      </button>
    );
  }
  return <audio className="media-audio" src={bust(url, n)} controls preload="none" onError={() => setFailed(true)} />;
}

export default function PostCard({
  post,
  isFav,
  onToggleFav,
  onPin,
  isLiked,
  onToggleLike,
  likeCount,
}: {
  post: Post;
  isFav?: boolean;
  onToggleFav?: (post: Post) => void;
  onPin?: (post: Post) => void;
  isLiked?: boolean;
  onToggleLike?: (post: Post) => void;
  likeCount?: number; // показываем только если передан (автору канала)
}) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const photos = post.media.filter((m) => m.type === "photo" || m.type === "sticker");

  // Считаем просмотр поста, только когда он реально попал в область видимости.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((ents) => {
      if (ents.some((e) => e.isIntersecting)) { track("post", post.link); io.disconnect(); }
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [post.link]);
  // Нечего показать (опрос, гео, контакт и т.п.) — текста нет и медиа не извлеклось.
  const nothing = !post.text && post.media.filter((m) => m.type !== "unsupported").length === 0;

  return (
    <article className="card fade-in" ref={rootRef}>
      <div className="post-head">
        <Link to={`/channel/${post.channel}`} className="ava-link" aria-label="Страница канала">
          {post.channelAvatar ? (
            <RImg className="ava" src={post.channelAvatar} />
          ) : (
            <div className="ava ava-ph">@</div>
          )}
        </Link>
        <Link className="post-title" to={`/channel/${post.channel}`}>
          {post.channelTitle || `@${post.channel}`}
        </Link>
        <span className="post-meta">@{post.channel}</span>
        {/* Плюсик относится к КАНАЛУ, поэтому остаётся в шапке. */}
        <AddChannelButton channel={post.channel} />
      </div>

      {nothing && (
        <a href={post.link} target="_blank" rel="noreferrer" className="media-doc" style={{ textAlign: "center" }}>
          📌 Пост нестандартного формата (опрос и т.п.). Открыть в канале ↗
        </a>
      )}

      {post.text && <PostText html={post.text} />}

      {photos.length > 0 && (
        <div className={`media-grid n${Math.min(photos.length, 4)}`}>
          {photos.map((m, i) => (
            <button key={i} type="button" className="media-img-wrap" onClick={() => setLightbox(i)} aria-label="Открыть фото">
              <RImg src={(m as { url: string }).url} />
            </button>
          ))}
        </div>
      )}
      {lightbox != null && (
        <Lightbox images={photos.map((m) => (m as { url: string }).url)} index={lightbox} onClose={() => setLightbox(null)} />
      )}

      {post.media.map((m, i) => (
        <MediaBlock key={i} m={m} link={post.link} channel={post.channel} msgId={post.msgId} />
      ))}

      {/* Действия с ПОСТОМ — внизу, чтобы не мотать к началу длинного поста.
          Слева дата и ссылка, справа кнопки. */}
      <div className="post-foot">
        <div className="post-foot-meta">
          <span>{shortDateTime(post.postedAt)}</span>
          <a href={post.link} target="_blank" rel="noreferrer">в Telegram ↗</a>
        </div>
        <div className="post-actions">
          <button
            className="fav-btn"
            onClick={() => shareLink(postUrl(post.channel, post.msgId), post.channelTitle || `@${post.channel}`)}
            aria-label="Поделиться постом" title="Поделиться"
          >
            <Icon name="share" size={18} />
          </button>
          {onToggleLike && (
            <button className={`fav-btn like-btn ${isLiked ? "on" : ""}`} onClick={() => onToggleLike(post)} aria-label="Нравится" title="Нравится">
              <Icon name="heart" size={19} />
              {likeCount !== undefined && likeCount > 0 && <span className="like-count">{likeCount}</span>}
            </button>
          )}
          {onToggleFav && (
            <button className={`fav-btn ${isFav ? "on" : ""}`} onClick={() => onToggleFav(post)} aria-label="В избранное" title="В избранное">
              <Icon name="star" size={19} />
            </button>
          )}
          {onPin && (
            <button className="fav-btn" onClick={() => onPin(post)} aria-label="Закрепить в канале" title="Закрепить в канале">📌</button>
          )}
        </div>
      </div>
    </article>
  );
}

function LoadableVideo({ thumb, link, channel, msgId, round }: { thumb?: string; link: string; channel: string; msgId: number; round?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "toobig" | "error">("idle");

  async function load() {
    setState("loading");
    const r = await loadPostMedia(channel, msgId);
    if (r.url) { setUrl(r.url); setState("idle"); }
    else if (r.tooBig) setState("toobig");
    else setState("error");
  }

  if (url) return <RVideo url={url} thumb={thumb} round={round} />;

  return (
    <div className="media-img-wrap" style={{ position: "relative", minHeight: 120 }}>
      {thumb && <RImg src={thumb} />}
      <div className="play-badge" style={{ flexDirection: "column", gap: 8 }}>
        {state === "idle" && <button className="btn sm" onClick={load}>⬇ Загрузить видео</button>}
        {state === "loading" && <span>Загружаю видео…</span>}
        {state === "toobig" && <a href={link} target="_blank" rel="noreferrer" className="btn sm">Видео большое — открыть в Telegram ↗</a>}
        {state === "error" && (
          <>
            <button className="btn sm" onClick={load}>↻ Повторить</button>
            <a href={link} target="_blank" rel="noreferrer" style={{ color: "#fff" }}>или открыть в Telegram ↗</a>
          </>
        )}
      </div>
    </div>
  );
}

// Аудио/голосовое без прямой ссылки (t.me/s не отдаёт файл) — догружаем по кнопке
// через MTProto (loadPostMedia) и проигрываем.
function LoadableAudio({ kind, label, link, channel, msgId }: { kind: "voice" | "audio"; label?: string; link: string; channel: string; msgId: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "toobig" | "error">("idle");
  async function load() {
    setState("loading");
    const r = await loadPostMedia(channel, msgId);
    if (r.url) { setUrl(r.url); setState("idle"); }
    else if (r.tooBig) setState("toobig");
    else setState("error");
  }
  if (url) return <RAudio url={url} />;
  const idleLabel = kind === "voice" ? "▶ Прослушать голосовое" : `▶ ${label || "Прослушать аудио"}`;
  return (
    <div className="media-doc" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {state === "idle" && <button className="btn secondary sm" onClick={load}>{idleLabel}</button>}
      {state === "loading" && <span className="muted">Загружаю аудио…</span>}
      {state === "toobig" && <a href={link} target="_blank" rel="noreferrer">Файл большой — открыть в Telegram ↗</a>}
      {state === "error" && (
        <>
          <button className="btn ghost sm" onClick={load}>↻ Повторить</button>
          <a href={link} target="_blank" rel="noreferrer" className="muted">или в Telegram ↗</a>
        </>
      )}
    </div>
  );
}

// Файл: не уводим в Telegram, а догружаем через MTProto и скачиваем прямо здесь.
function LoadableDoc({ title, extra, link, channel, msgId }: { title: string; extra?: string; link: string; channel: string; msgId: number }) {
  const [state, setState] = useState<"idle" | "loading" | "toobig" | "error">("idle");

  async function download() {
    setState("loading");
    const r = await loadPostMedia(channel, msgId);
    if (r.url) {
      try {
        const resp = await fetch(r.url);
        if (!resp.ok) throw new Error();
        const blob = await resp.blob();
        const href = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = href; a.download = title || "file";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 10_000);
        setState("idle");
      } catch { setState("error"); }
    } else if (r.tooBig) setState("toobig");
    else setState("error");
  }

  return (
    <div className="media-doc" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span>📎 {title}{extra ? <span className="muted"> · {extra}</span> : null}</span>
      {state === "idle" && <button className="btn secondary sm" onClick={download}>⬇ Скачать</button>}
      {state === "loading" && <span className="muted">Загружаю файл…</span>}
      {state === "toobig" && <a href={link} target="_blank" rel="noreferrer">Файл большой — открыть в Telegram ↗</a>}
      {state === "error" && (
        <>
          <button className="btn ghost sm" onClick={download}>↻ Повторить</button>
          <a href={link} target="_blank" rel="noreferrer" className="muted">или в Telegram ↗</a>
        </>
      )}
    </div>
  );
}

function MediaBlock({ m, link, channel, msgId }: { m: Media; link: string; channel: string; msgId: number }) {
  if (m.type === "video" || m.type === "roundvideo") {
    if (m.url) {
      return <RVideo url={m.url} thumb={m.thumb} round={m.type === "roundvideo"} />;
    }
    // Крупное видео (нет прямой ссылки в t.me/s) — предлагаем догрузить через MTProto.
    return <LoadableVideo thumb={m.thumb} link={link} channel={channel} msgId={msgId} round={m.type === "roundvideo"} />;
  }
  if (m.type === "voice") {
    return m.url ? <RAudio url={m.url} /> : <LoadableAudio kind="voice" link={link} channel={channel} msgId={msgId} />;
  }
  if (m.type === "audio") {
    const label = [m.performer, m.title].filter(Boolean).join(" — ") || "Аудио";
    return m.url ? <RAudio url={m.url} /> : <LoadableAudio kind="audio" label={label} link={link} channel={channel} msgId={msgId} />;
  }
  if (m.type === "document") {
    return <LoadableDoc title={m.title} extra={m.extra} link={link} channel={channel} msgId={msgId} />;
  }
  if (m.type === "link") {
    return (
      <a href={m.href || link} target="_blank" rel="noreferrer" className="media-link">
        {m.image && <RImg src={m.image} />}
        <div className="media-link-body">
          {m.site && <div className="muted" style={{ fontSize: 12 }}>{m.site}</div>}
          {m.title && <div style={{ fontWeight: 700 }}>{m.title}</div>}
          {m.description && <div className="muted" style={{ fontSize: 13 }}>{m.description}</div>}
        </div>
      </a>
    );
  }
  return null;
}
