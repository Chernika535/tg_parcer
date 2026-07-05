import { useState } from "react";
import { Link } from "react-router-dom";
import type { Post, Media } from "../lib/data.ts";
import { loadPostMedia } from "../lib/data.ts";
import Icon from "./Icon.tsx";
import { shareLink, postUrl } from "../lib/share.ts";
import { linkify } from "../lib/linkify.tsx";
import AddChannelButton from "./AddChannelButton.tsx";

// Полные дата и время публикации поста (подпись внизу карточки).
function fullDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} дн`;
  return new Date(iso).toLocaleDateString("ru-RU");
}

const LIMIT = 360;

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
  return (
    <video
      className={round ? "media-video round" : "media-video"}
      src={bust(url, n)}
      poster={thumb ? bust(thumb, n) : undefined}
      controls
      playsInline
      preload="metadata"
      onError={() => setFailed(true)}
    />
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
  const [expanded, setExpanded] = useState(false);
  const long = post.text.length > LIMIT;
  const shown = expanded || !long ? post.text : post.text.slice(0, LIMIT) + "…";
  const photos = post.media.filter((m) => m.type === "photo" || m.type === "sticker");
  // Нечего показать (опрос, гео, контакт и т.п.) — текста нет и медиа не извлеклось.
  const nothing = !post.text && post.media.filter((m) => m.type !== "unsupported").length === 0;

  return (
    <article className="card fade-in">
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
        <span className="post-meta">@{post.channel} · {relativeTime(post.postedAt)}</span>
        <AddChannelButton channel={post.channel} />
        {onPin && (
          <button className="fav-btn" onClick={() => onPin(post)} aria-label="Закрепить в канале" title="Закрепить в канале">📌</button>
        )}
        <button
          className="fav-btn"
          onClick={() => shareLink(postUrl(post.channel, post.msgId), post.channelTitle || `@${post.channel}`)}
          aria-label="Поделиться постом"
        >
          <Icon name="share" size={17} />
        </button>
        {onToggleLike && (
          <button
            className={`fav-btn like-btn ${isLiked ? "on" : ""}`}
            onClick={() => onToggleLike(post)}
            aria-label="Нравится"
            title="Нравится"
          >
            <Icon name="heart" size={18} />
            {likeCount !== undefined && likeCount > 0 && <span className="like-count">{likeCount}</span>}
          </button>
        )}
        {onToggleFav && (
          <button
            className={`fav-btn ${isFav ? "on" : ""}`}
            onClick={() => onToggleFav(post)}
            aria-label="В избранное"
            title="В избранное"
          >
            <Icon name="star" size={18} />
          </button>
        )}
      </div>

      {nothing && (
        <a href={post.link} target="_blank" rel="noreferrer" className="media-doc" style={{ textAlign: "center" }}>
          📌 Пост нестандартного формата (опрос и т.п.). Открыть в канале ↗
        </a>
      )}

      {post.text && <div className="post-text">{linkify(shown)}</div>}
      {long && (
        <button className="btn ghost sm" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Свернуть" : "Показать ещё"}
        </button>
      )}

      {photos.length > 0 && (
        <div className={`media-grid n${Math.min(photos.length, 4)}`}>
          {photos.map((m, i) => (
            <a key={i} href={post.link} target="_blank" rel="noreferrer" className="media-img-wrap">
              <RImg src={(m as { url: string }).url} />
            </a>
          ))}
        </div>
      )}

      {post.media.map((m, i) => (
        <MediaBlock key={i} m={m} link={post.link} channel={post.channel} msgId={post.msgId} />
      ))}

      <div className="row spread" style={{ marginTop: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>{fullDateTime(post.postedAt)}</span>
        <a href={post.link} target="_blank" rel="noreferrer" className="muted">Открыть в Telegram ↗</a>
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

function MediaBlock({ m, link, channel, msgId }: { m: Media; link: string; channel: string; msgId: number }) {
  if (m.type === "video" || m.type === "roundvideo") {
    if (m.url) {
      return <RVideo url={m.url} thumb={m.thumb} round={m.type === "roundvideo"} />;
    }
    // Крупное видео (нет прямой ссылки в t.me/s) — предлагаем догрузить через MTProto.
    return <LoadableVideo thumb={m.thumb} link={link} channel={channel} msgId={msgId} round={m.type === "roundvideo"} />;
  }
  if (m.type === "voice") {
    return m.url ? <RAudio url={m.url} /> : null;
  }
  if (m.type === "document") {
    return (
      <a href={link} target="_blank" rel="noreferrer" className="media-doc">
        📎 {m.title}
        {m.extra ? <span className="muted"> · {m.extra}</span> : null}
      </a>
    );
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
