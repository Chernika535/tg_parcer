export type SortMode = "new" | "old" | "title";
export type Filters = { query: string; tags: string[]; official: boolean; byAdmin: boolean; sort: SortMode };

export const emptyFilters: Filters = { query: "", tags: [], official: false, byAdmin: false, sort: "new" };

// Поиск по названию + фильтры (теги, бейджи, сортировка).
export default function FeedFilter({
  filters,
  setFilters,
  allTags,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  allTags: string[];
}) {
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const toggleTag = (t: string) =>
    set({ tags: filters.tags.includes(t) ? filters.tags.filter((x) => x !== t) : [...filters.tags, t] });

  // Показываем кнопками только 20 самых популярных тегов + уже выбранные (чтобы
  // выбранный тег не исчезал из списка, если он не в топ-20).
  const popular = allTags.slice(0, 20);
  const tagButtons = [...new Set([...filters.tags, ...popular])];

  // Подсказки при вводе: теги (по всему списку), совпадающие с запросом и ещё не выбранные.
  const q = filters.query.trim().toLowerCase();
  const suggestions = q
    ? allTags.filter((t) => t.includes(q) && !filters.tags.includes(t)).slice(0, 12)
    : [];

  return (
    <div className="filter">
      <div className="search">
        <span className="search-ico">🔍</span>
        <input
          type="text"
          placeholder="Поиск по названию или тегам…"
          value={filters.query}
          onChange={(e) => set({ query: e.target.value })}
        />
        {filters.query && (
          <button className="search-clear" onClick={() => set({ query: "" })} aria-label="Очистить">✕</button>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="chip-row" style={{ marginTop: 2 }}>
          <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>теги:</span>
          {suggestions.map((t) => (
            <button key={t} className="chip chip-btn" onClick={() => set({ tags: [...filters.tags, t], query: "" })}>
              #{t}
            </button>
          ))}
        </div>
      )}

      <div className="chip-row">
        <button className={`chip chip-btn ${filters.official ? "chip-active" : ""}`} onClick={() => set({ official: !filters.official })}>
          ✓ официальные
        </button>
        <button className={`chip chip-btn ${filters.byAdmin ? "chip-active" : ""}`} onClick={() => set({ byAdmin: !filters.byAdmin })}>
          от админа
        </button>
        <select className="sort-sel" value={filters.sort} onChange={(e) => set({ sort: e.target.value as SortMode })}>
          <option value="new">сначала новые</option>
          <option value="old">сначала старые</option>
          <option value="title">по названию</option>
        </select>
      </div>

      {tagButtons.length > 0 && (
        <div className="chip-row">
          {tagButtons.map((t) => (
            <button key={t} className={`chip chip-btn ${filters.tags.includes(t) ? "chip-active" : ""}`} onClick={() => toggleTag(t)}>
              #{t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type FeedLike = { title: string; tags: string[]; official?: boolean; by_admin?: boolean; created_at?: string };

export function applyFilters<T extends FeedLike>(feeds: T[], f: Filters): T[] {
  const q = f.query.trim().toLowerCase();
  const out = feeds.filter((x) => {
    const matchQ = !q || x.title.toLowerCase().includes(q) || x.tags.some((t) => t.includes(q));
    // Несколько тегов — по «хотя бы один» (OR): показываем ленты с любым из выбранных.
    const matchTags = f.tags.length === 0 || f.tags.some((t) => x.tags.includes(t));
    const matchOff = !f.official || !!x.official;
    const matchAdm = !f.byAdmin || !!x.by_admin;
    return matchQ && matchTags && matchOff && matchAdm;
  });
  out.sort((a, b) => {
    if (f.sort === "title") return a.title.localeCompare(b.title);
    const da = a.created_at ?? "";
    const db = b.created_at ?? "";
    return f.sort === "old" ? da.localeCompare(db) : db.localeCompare(da);
  });
  return out;
}

// Все теги, отсортированные по популярности (самые частые — первыми). При равной
// частоте — по алфавиту. Полный список нужен для подсказок при поиске; для кнопок
// берём только первые 20 (иначе на больших каталогах будет «простыня»).
export function allTagsOf(feeds: { tags: string[] }[]): string[] {
  const cnt = new Map<string, number>();
  for (const f of feeds) for (const t of f.tags) cnt.set(t, (cnt.get(t) ?? 0) + 1);
  return [...cnt.keys()].sort((a, b) => (cnt.get(b)! - cnt.get(a)!) || a.localeCompare(b));
}
