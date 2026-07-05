import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createFeed, type Feed } from "../lib/data.ts";
import { TopBar, Empty } from "../components/States.tsx";

// Аварийное восстановление лент из кэша браузера (localStorage tf_feedmeta_*).
// Помогает, если лента была удалена в БД, но её открывали на этом устройстве.
function cachedFeeds(): Feed[] {
  const out: Feed[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("tf_feedmeta_")) continue;
      try { out.push(JSON.parse(localStorage.getItem(k)!) as Feed); } catch { /* пропускаем битые */ }
    }
  } catch { /* приватный режим */ }
  return out;
}

export default function RecoverFeeds() {
  const nav = useNavigate();
  const [items] = useState<Feed[]>(() => cachedFeeds());
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [q, setQ] = useState("");

  const shown = useMemo(
    () => items.filter((f) => !q.trim() || (f.title || "").toLowerCase().includes(q.trim().toLowerCase())),
    [items, q],
  );

  async function restore(f: Feed) {
    setBusy(f.id); setMsg("");
    try {
      const created = await createFeed({
        title: f.title,
        description: f.description ?? null,
        cover_url: f.cover_url ?? null,
        author_name: f.author_name ?? null,
        channels: f.channels ?? [],
        visibility: f.visibility ?? "private",
        tags: f.tags ?? [],
      });
      setMsg(`Лента «${f.title}» восстановлена. Открываю…`);
      setTimeout(() => nav(`/my/${created.id}/edit`), 700);
    } catch (e) {
      setMsg("Ошибка: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <TopBar title="Восстановление лент" onBack={() => nav(-1)} />
      <div className="content">
        <div className="card" style={{ fontSize: 13 }}>
          Здесь — ленты, сохранённые в кэше <b>этого устройства</b> (вы их открывали).
          Нажмите «Восстановить», чтобы пересоздать ленту на свой аккаунт со всеми каналами.
        </div>
        <div className="field">
          <input type="text" placeholder="Поиск по названию…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {shown.length === 0 && <Empty>В кэше этого устройства лент не найдено.</Empty>}
        {shown.map((f) => (
          <div key={f.id} className="card">
            <div style={{ fontWeight: 800, fontSize: 16 }}>{f.title || "Без названия"}</div>
            {f.description && <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{f.description}</div>}
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{(f.channels ?? []).length} каналов:</div>
            <div className="tags" style={{ marginTop: 4 }}>
              {(f.channels ?? []).map((c, i) => <span key={i} className="tag">{c}</span>)}
            </div>
            <button className="btn sm" style={{ marginTop: 10 }} disabled={busy === f.id} onClick={() => restore(f)}>
              {busy === f.id ? "Восстанавливаю…" : "Восстановить"}
            </button>
          </div>
        ))}
        {msg && <div className="card" style={{ fontSize: 13 }}>{msg}</div>}
      </div>
    </>
  );
}
