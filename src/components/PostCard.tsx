import { useState, type ReactNode } from "react";
import type { Post, Media } from "../lib/data.ts";
import Icon from "./Icon.tsx";
import { shareLink } from "../lib/share.ts";

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
// Порядок важен: сначала markdown-ссылка [текст](url), потом голый url, потом @упоминание.
const TOKEN_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|((?:https?:\/\/|www\.)[^\s]+)|(@[a-zA-Z][a-zA-Z0-9_]{3,})/g;

// Делает ссылки (в т.ч. ссылки-текстом), @упоминания кликабельными, сохраняя переносы.
function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  let key = 0;
  while ((m = TOKEN_RE.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (m[1] && m[2]) {
      nodes.push(
        <a key={key++} href={m[2]} target="_blank" rel="noreferrer" className="ln">{m[1]}</a>,
      );
    } else if (m[3]) {
      const href = tok.startsWith("www.") ? "https://" + tok : tok;
      nodes.push(
        <a key={key++} href={href} target="_blank" rel="noreferrer" className="ln">{tok}</a>,
      );
    } else {
      nodes.push(
        <a key={key++} href={`https://t.me/${tok.slice(1)}`} target="_blank" rel="noreferrer" className="ln">{tok}</a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
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
}: {
  post: Post;
  isFav?: boolean;
  onToggleFav?: (post: Post) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = post.text.length > LIMIT;
  const shown = expanded || !long ? post.text : post.text.slice(0, LIMIT) + "…";
  const photos = post.media.filter((m) => m.type === "photo" || m.type === "sticker");

  return (
    <article className="card fade-in">
      <div className="post-head">
        {post.channelAvatar ? (
          <RImg className="ava" src={post.channelAvatar} />
        ) : (
          <div className="ava ava-ph">@</div>
        )}
        <a className="post-title" href={`https://t.me/${post.channel}`} target="_blank" rel="noreferrer">
          {post.channelTitle || `@${post.channel}`}
        </a>
        <span className="post-meta">@{post.channel} · {relativeTime(post.postedAt)}</span>
        <button
          className="fav-btn"
          onClick={() => shareLink(post.link, post.channelTitle || `@${post.channel}`)}
          aria-label="Поделиться постом"
        >
          <Icon name="share" size={17} />
        </button>
        {onToggleFav && (
          <button
            className={`fav-btn ${isFav ? "on" : ""}`}
            onClick={() => onToggleFav(post)}
            aria-label="В избранное"
          >
            <Icon name="heart" size={18} />
          </button>
        )}
      </div>

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
        <MediaBlock key={i} m={m} link={post.link} />
      ))}

      <div className="row spread" style={{ marginTop: 8 }}>
        <span />
        <a href={post.link} target="_blank" rel="noreferrer" className="muted">Открыть в Telegram ↗</a>
      </div>
    </article>
  );
}

function MediaBlock({ m, link }: { m: Media; link: string }) {
  if (m.type === "video" || m.type === "roundvideo") {
    if (m.url) {
      return <RVideo url={m.url} thumb={m.thumb} round={m.type === "roundvideo"} />;
    }
    return (
      <a href={link} target="_blank" rel="noreferrer" className="media-img-wrap">
        {m.thumb && <RImg src={m.thumb} />}
        <span className="play-badge">▶ Видео — открыть</span>
      </a>
    );
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
