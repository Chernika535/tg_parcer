import { useState } from "react";
import { useAuth } from "../lib/auth.tsx";
import { myFeeds, updateFeed, createFeed, type Feed } from "../lib/data.ts";
import Icon from "./Icon.tsx";

// Маленькая кнопка «+» на посте: добавить этот канал в одну из своих лент
// (или создать новую) — не запоминая ник и не выходя из ленты.
export default function AddChannelButton({ channel }: { channel: string }) {
  const { session } = useAuth();
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

  async function addTo(f: Feed) {
    if (f.channels.includes(channel)) { setDone(`Уже в «${f.title}»`); return; }
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
    setBusy(true);
    try {
      const f = await createFeed({ title: `@${channel}`, visibility: "private", channels: [channel] });
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
                <button key={f.id} className="sheet-item" disabled={busy} onClick={() => addTo(f)}>
                  {f.channels.includes(channel) ? "✓ " : "+ "}{f.title}
                </button>
              ))}
            </div>
            <button className="btn sm" disabled={busy} onClick={newFeed}>+ Новая лента из этого канала</button>
            {done && <p className="muted" style={{ marginTop: 8 }}>{done}</p>}
          </div>
        </div>
      )}
    </>
  );
}
