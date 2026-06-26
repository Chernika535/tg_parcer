import { useState } from "react";
import type { Post } from "../lib/data.ts";

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

const LIMIT = 280;

export default function PostCard({ post }: { post: Post }) {
  const [expanded, setExpanded] = useState(false);
  const long = post.text.length > LIMIT;
  const shown = expanded || !long ? post.text : post.text.slice(0, LIMIT) + "…";

  return (
    <article className="card fade-in">
      <div className="row spread">
        <a href={`https://t.me/${post.channel}`} target="_blank" rel="noreferrer">
          <strong>@{post.channel}</strong>
        </a>
        <span className="muted">{relativeTime(post.postedAt)}</span>
      </div>
      {post.text && <div className="post-text">{shown}</div>}
      {long && (
        <button className="btn ghost sm" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Свернуть" : "Показать ещё"}
        </button>
      )}
      <div className="row spread" style={{ marginTop: 8 }}>
        <span>{post.hasMedia && <span className="badge">🖼 медиа</span>}</span>
        <a href={post.link} target="_blank" rel="noreferrer" className="muted">
          Открыть пост ↗
        </a>
      </div>
    </article>
  );
}
