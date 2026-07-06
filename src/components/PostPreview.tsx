import type { PostMedia } from "../lib/data.ts";

// Превью поста «как в ленте» — для запланированных постов в кабинете автора.
// html уже безопасный (генерится нашим редактором: b/i/u/s/a/code/pre/tg-spoiler).
export default function PostPreview({
  channelName, avatar, html, media,
}: { channelName: string; avatar?: string; html: string; media: PostMedia[] }) {
  const visuals = media.filter((m) => m.type === "photo" || m.type === "video");
  const others = media.filter((m) => m.type !== "photo" && m.type !== "video");
  const label = (m: PostMedia) =>
    m.type === "voice" ? "🎤 голосовое" : m.type === "audio" ? `🎵 ${m.title || "музыка"}`
    : m.type === "videonote" ? "⭕ кружок" : `📎 ${m.name || "файл"}`;

  return (
    <article className="card preview-card">
      <div className="post-head">
        {avatar ? <img className="ava" alt="" src={avatar} /> : <div className="ava ava-ph">@</div>}
        <span className="post-title">{channelName}</span>
      </div>
      {html && (
        <div
          className="post-text"
          onClick={(e) => {
            const t = (e.target as HTMLElement).closest(".tg-spoiler");
            if (t) t.classList.toggle("revealed");
          }}
          dangerouslySetInnerHTML={{ __html: html.replace(/\n/g, "<br>") }}
        />
      )}
      {visuals.length > 0 && (
        <div className={`media-grid n${Math.min(visuals.length, 4)}`}>
          {visuals.map((m, i) => (
            <div key={i} className="media-img-wrap">
              {m.type === "photo" ? <img src={m.url} alt="" /> : <video src={m.url} controls playsInline preload="metadata" />}
            </div>
          ))}
        </div>
      )}
      {others.map((m, i) => {
        if (m.type === "videonote") return <video key={i} className="media-video round" src={m.url} controls playsInline preload="metadata" />;
        if (m.type === "voice" || m.type === "audio") return <audio key={i} className="media-audio" src={m.url} controls preload="none" />;
        return <div key={i} className="media-doc">{label(m)}</div>;
      })}
    </article>
  );
}
