import { useState } from "react";
import type { Post, Media } from "../lib/data.ts";
import Icon from "./Icon.tsx";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} дн назад`;
  return new Date(iso).toLocaleDateString("ru-RU");
}

const LIMIT = 360;

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
      <div className="row" style={{ gap: 10 }}>
        {post.channelAvatar ? (
          <img className="ava" src={post.channelAvatar} alt="" loading="lazy" />
        ) : (
          <div className="ava ava-ph">@</div>
        )}
        <div className="grow">
          <a href={`https://t.me/${post.channel}`} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
            <strong>{post.channelTitle || `@${post.channel}`}</strong>
          </a>
          <div className="muted" style={{ fontSize: 12 }}>
            @{post.channel} · {relativeTime(post.postedAt)}
            {post.views ? ` · ${post.views}` : ""}
          </div>
        </div>
        {onToggleFav && (
          <button
            className={`fav-btn ${isFav ? "on" : ""}`}
            onClick={() => onToggleFav(post)}
            aria-label="В избранное"
          >
            <Icon name="heart" size={20} />
          </button>
        )}
      </div>

      {post.text && <div className="post-text">{shown}</div>}
      {long && (
        <button className="btn ghost sm" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Свернуть" : "Показать ещё"}
        </button>
      )}

      {photos.length > 0 && (
        <div className={`media-grid n${Math.min(photos.length, 4)}`}>
          {photos.map((m, i) => (
            <a key={i} href={post.link} target="_blank" rel="noreferrer" className="media-img-wrap">
              <img src={(m as { url: string }).url} alt="" loading="lazy" />
            </a>
          ))}
        </div>
      )}

      {post.media.map((m, i) => (
        <MediaBlock key={i} m={m} link={post.link} />
      ))}

      <div className="row spread" style={{ marginTop: 8 }}>
        <span />
        <a href={post.link} target="_blank" rel="noreferrer" className="muted">
          Открыть в Telegram ↗
        </a>
      </div>
    </article>
  );
}

function MediaBlock({ m, link }: { m: Media; link: string }) {
  if (m.type === "video" || m.type === "roundvideo") {
    if (m.url) {
      return (
        <video
          className={m.type === "roundvideo" ? "media-video round" : "media-video"}
          src={m.url}
          poster={m.thumb}
          controls
          playsInline
          preload="metadata"
        />
      );
    }
    // видео без прямого src (большое) — показываем превью + ссылку
    return (
      <a href={link} target="_blank" rel="noreferrer" className="media-img-wrap">
        {m.thumb && <img src={m.thumb} alt="" loading="lazy" />}
        <span className="play-badge">▶ Видео — открыть</span>
      </a>
    );
  }
  if (m.type === "voice") {
    return m.url ? <audio className="media-audio" src={m.url} controls preload="none" /> : null;
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
        {m.image && <img src={m.image} alt="" loading="lazy" />}
        <div className="media-link-body">
          {m.site && <div className="muted" style={{ fontSize: 12 }}>{m.site}</div>}
          {m.title && <div style={{ fontWeight: 600 }}>{m.title}</div>}
          {m.description && <div className="muted" style={{ fontSize: 13 }}>{m.description}</div>}
        </div>
      </a>
    );
  }
  return null; // photo/sticker рендерятся в сетке выше
}
