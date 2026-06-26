import type { ReactNode } from "react";
import type { Feed } from "../lib/data.ts";
import { coverGradient, initials } from "../lib/visual.ts";

export default function FeedCard({
  feed,
  onOpen,
  ownerName,
  statusBadge,
  actions,
}: {
  feed: Feed;
  onOpen: () => void;
  ownerName?: string | null;
  statusBadge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="feed-card fade-in">
      <div
        className="feed-cover"
        style={{ background: coverGradient(`${feed.title}${feed.id}`) }}
        onClick={onOpen}
      >
        <span className="feed-cover-init">{initials(feed.title)}</span>
        {statusBadge && <div className="feed-cover-badge">{statusBadge}</div>}
      </div>
      <div className="feed-card-body">
        <div className="feed-card-title" onClick={onOpen}>
          {feed.title}
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {feed.channels.length} каналов{ownerName ? ` · ${ownerName}` : ""}
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
