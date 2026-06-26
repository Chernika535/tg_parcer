// Поиск по названию + фильтр по тегам.
export default function FeedFilter({
  query,
  setQuery,
  allTags,
  active,
  toggleTag,
}: {
  query: string;
  setQuery: (s: string) => void;
  allTags: string[];
  active: string[];
  toggleTag: (t: string) => void;
}) {
  return (
    <div className="filter">
      <div className="search">
        <span className="search-ico">🔍</span>
        <input
          type="text"
          placeholder="Поиск по названию или тегам…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery("")} aria-label="Очистить">
            ✕
          </button>
        )}
      </div>
      {allTags.length > 0 && (
        <div className="chip-row">
          {allTags.map((t) => (
            <button
              key={t}
              className={`chip chip-btn ${active.includes(t) ? "chip-active" : ""}`}
              onClick={() => toggleTag(t)}
            >
              #{t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function filterFeeds<T extends { title: string; tags: string[] }>(
  feeds: T[],
  query: string,
  active: string[],
): T[] {
  const q = query.trim().toLowerCase();
  return feeds.filter((f) => {
    const matchQ =
      !q ||
      f.title.toLowerCase().includes(q) ||
      f.tags.some((t) => t.includes(q));
    const matchTags = active.length === 0 || active.every((t) => f.tags.includes(t));
    return matchQ && matchTags;
  });
}

export function allTagsOf(feeds: { tags: string[] }[]): string[] {
  return [...new Set(feeds.flatMap((f) => f.tags))].sort();
}
