import type { PostMedia } from "../lib/data.ts";

// Превью поста «как в ленте» — для запланированных постов в кабинете автора.
// html уже безопасный (генерится нашим редактором: b/i/u/s/a/code/pre/tg-spoiler).
export default function PostPreview({
  channelName, avatar, html, media,
}: { channelName: string; avatar?: string; html: string; media: PostMedia[] }) {
  const visuals = media.filter((m) => m.type === "photo" || m.type === "video");
  const others = media.filter((m) => m.type !== "photo" && m.type !== "video");
  const label = (m: PostMedia) =>
    m.type === "voice" ? "🎤 голосовое" : m.type === "audio" ? `🎵 ${m.title || "музыка"}` : `📎 ${m.name || "файл"}`;

  return (
    <article className="card preview-card">
      <div className="post-head">
        {avatar ? <img className="ava" alt="" src={avatar} /> : <div className="ava ava-ph">@</div>}
        <span className="post-title">{channelName}</span>
      </div>
      {html && <div className="post-text" dangerouslySetInnerHTML={{ __html: html.replace(/\n/g, "<br>") }} />}
      {visuals.length > 0 && (
        <div className={`media-grid n${Math.min(visuals.length, 4)}`}>
          {visuals.map((m, i) => (
            <div key={i} className="media-img-wrap">
              {m.type === "photo" ? <img src={m.url} alt="" /> : <video src={m.url} muted playsInline preload="metadata" />}
            </div>
          ))}
        </div>
      )}
      {others.map((m, i) => <div key={i} className="media-doc">{label(m)}</div>)}
    </article>
  );
}
