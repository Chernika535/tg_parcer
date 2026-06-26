import type { ReactNode } from "react";
import type { Feed } from "../lib/data.ts";
import CoverArt from "./CoverArt.tsx";
import Icon from "./Icon.tsx";

export default function FeedCard({
  feed,
  onOpen,
  statusBadge,
  actions,
}: {
  feed: Feed;
  onOpen: () => void;
  statusBadge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="feed-card fade-in">
      <div className="feed-cover" onClick={onOpen}>
        <CoverArt seed={`${feed.title}${feed.id}`} src={feed.cover_url} className="feed-cover-art" />
        <div className="feed-cover-badges">
          {feed.official && (
            <span className="tag-badge official"><Icon name="check" size={12} /> официальный</span>
          )}
          {feed.by_admin && !feed.official && (
            <span className="tag-badge admin"><Icon name="shield" size={12} /> от админа</span>
          )}
        </div>
        {statusBadge && <div className="feed-cover-status">{statusBadge}</div>}
      </div>
      <div className="feed-card-body">
        <div className="feed-card-title" onClick={onOpen}>
          {feed.title}
        </div>
        {feed.description && <div className="feed-card-desc">{feed.description}</div>}
        <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
          {feed.channels.length} каналов
          {feed.author_name ? ` · ${feed.author_name}` : feed.owner?.display_name ? ` · ${feed.owner.display_name}` : ""}
        </div>
        <div className="tags" style={{ marginTop: 8 }}>
          <span className={`chip ${feed.visibility === "public" ? "chip-public" : "chip-private"}`}>
            {feed.visibility === "public" ? "публичная" : "личная"}
          </span>
          {feed.tags?.map((t) => (
            <span key={t} className="chip">#{t}</span>
          ))}
        </div>
        {actions && <div className="row" style={{ gap: 6, marginTop: 10 }}>{actions}</div>}
      </div>
    </div>
  );
}
