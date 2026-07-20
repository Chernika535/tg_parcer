import { useState } from "react";
import { useAuth } from "../lib/auth.tsx";
import { myFeeds, updateFeed, createFeed, type Feed } from "../lib/data.ts";
import Icon from "./Icon.tsx";

// Маленькая кнопка «+» на посте: добавить этот канал в одну из своих лент
// (или создать новую) — не запоминая ник и не выходя из ленты.
function nc(c: string): string {
  return (c || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^t\.me\//, "").replace(/^s\//, "").replace(/^@/, "")
    .split(/[/?#]/)[0].replace(/[^a-z0-9_]/g, "");
}

export default function AddChannelButton({ channel }: { channel: string }) {
  const { session, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  if (!session) return null;

  async function openPicker() {
    setOpen(true);
    setDone("");
    if (!feeds) {
      try { setFeeds(await myFeeds()); } catch { setFeeds([]); }
    }
  }

  // Клик по ленте: нет канала → добавить; есть (✓) → убрать (с подтверждением).
  async function toggle(f: Feed) {
    const inFeed = f.channels.some((c) => nc(c) === nc(channel));
    if (inFeed) {
      if (!isAdmin && f.visibility !== "private") { setDone("Убирать из публичной ленты может только админ"); return; }
      if (!confirm(`Убрать @${channel} из ленты «${f.title}»?`)) return;
      setBusy(true);
      try {
        const next = f.channels.filter((c) => nc(c) !== nc(channel));
        await updateFeed(f.id, { channels: next });
        setFeeds((prev) => (prev ?? []).map((x) => (x.id === f.id ? { ...x, channels: next } : x)));
        setDone(`Убрано из «${f.title}» ✓`);
      } catch (e) { setDone("Ошибка: " + (e as Error).message); }
      finally { setBusy(false); }
      return;
    }
    setBusy(true);
    try {
      await updateFeed(f.id, { channels: [...f.channels, channel] });
      setFeeds((prev) => (prev ?? []).map((x) => (x.id === f.id ? { ...x, channels: [...x.channels, channel] } : x)));
      setDone(`Добавлено в «${f.title}» ✓`);
    } catch (e) {
      setDone("Ошибка: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function newFeed() {
    const title = prompt("Название новой ленты:")?.trim();
    if (!title) return;
    setBusy(true);
    try {
      const f = await createFeed({ title, visibility: "private", channels: [channel] });
      setFeeds((prev) => [f, ...(prev ?? [])]);
      setDone(`Создана лента «${f.title}» ✓`);
    } catch (e) {
      setDone("Ошибка: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="fav-btn" onClick={openPicker} aria-label="Добавить канал в свою ленту" title="Добавить канал в свою ленту">
        <Icon name="plus" size={17} />
      </button>
      {open && (
        <div className="sheet-overlay" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="row spread">
              <b>Добавить @{channel} в ленту</b>
              <button className="btn ghost sm" onClick={() => setOpen(false)}>✕</button>
            </div>
            {!feeds && <p className="muted">Загрузка…</p>}
            {feeds && feeds.length === 0 && <p className="muted">У вас пока нет лент — создайте новую ниже.</p>}
            <div className="sheet-list">
              {feeds?.map((f) => (
                <button key={f.id} className="sheet-item" disabled={busy} onClick={() => toggle(f)}>
                  {f.channels.some((c) => nc(c) === nc(channel)) ? "✓ " : "+ "}{f.title}
                </button>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 12, margin: "6px 0" }}>Нажмите ленту с ✓, чтобы убрать канал из неё.</div>
            <button className="btn sm" disabled={busy} onClick={newFeed}>+ Новая лента из этого канала</button>
            {done && <p className="muted" style={{ marginTop: 8 }}>{done}</p>}
          </div>
        </div>
      )}
    </>
  );
}
