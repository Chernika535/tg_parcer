import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { publicFeeds, myFeeds, type Feed } from "../lib/data.ts";
import { useAuth } from "../lib/auth.tsx";
import { Loading, Empty } from "../components/States.tsx";

export default function Tags() {
  const { session } = useAuth();
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [q, setQ] = useState("");
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      const pub = await publicFeeds().catch(() => []);
      const mine = session ? await myFeeds().catch(() => []) : [];
      const seen = new Set<number>();
      const merged = [...pub, ...mine].filter((f) => (seen.has(f.id) ? false : seen.add(f.id)));
      setFeeds(merged);
    })();
  }, [session]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of feeds ?? []) for (const t of f.tags) m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [feeds]);

  const max = counts[0]?.[1] || 1;
  const shown = counts.filter(([t]) => !q.trim() || t.includes(q.trim().toLowerCase()));

  function diaFor(n: number) {
    return 64 + Math.round((n / max) * 84); // диаметр кружка 64..148px
  }

  return (
    <div className="tags-page">
      <div className="tags-cloud-wrap">
        {!feeds && <Loading />}
        {feeds && counts.length === 0 && <Empty>Пока нет тегов. Добавьте теги к лентам.</Empty>}
        <div className="tags-cloud">
          {shown.map(([t, n]) => {
            const d = diaFor(n);
            return (
              <button
                key={t}
                className="cloud-tag"
                style={{ width: d, height: d, fontSize: Math.max(12, Math.round(d * 0.16)) }}
                onClick={() => nav(`/feeds?tag=${encodeURIComponent(t)}`)}
                title={`${t} · ${n}`}
              >
                <span className="cloud-tag-name">#{t}</span>
                <span className="cloud-tag-count">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="tags-search">
        <div className="search glass">
          <span className="search-ico">🔎</span>
          <input
            type="text"
            placeholder="Искать тег…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && q.trim()) nav(`/feeds?tag=${encodeURIComponent(q.trim().toLowerCase())}`);
            }}
          />
          {q && <button className="search-clear" onClick={() => setQ("")}>✕</button>}
        </div>
      </div>
    </div>
  );
}
