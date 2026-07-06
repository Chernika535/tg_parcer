import { useState } from "react";
import { STYLES, styleCss, bakeImage, bakeVideo, type StyleId } from "../lib/filters.ts";

// Выбор стилевого фильтра для загруженного фото/видео. Показываем живое превью
// (CSS-фильтр), а по «Применить» запекаем фильтр в файл.
export default function MediaFilterPicker({ type, url, onDone, onCancel }: {
  type: "photo" | "video";
  url: string;
  onDone: (blob: Blob, styleId: StyleId) => void;
  onCancel: () => void;
}) {
  const [sel, setSel] = useState<StyleId>("none");
  const [smooth, setSmooth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const css = styleCss(sel);

  async function apply() {
    setBusy(true); setProg(0);
    try {
      const blob = await (await fetch(url)).blob();
      const out = type === "photo" ? await bakeImage(blob, css, smooth) : await bakeVideo(blob, css, setProg, smooth);
      onDone(out, sel);
    } catch (e) {
      alert("Не удалось применить фильтр: " + (e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="crop-overlay" onClick={busy ? undefined : onCancel}>
      <div className="crop-box" onClick={(e) => e.stopPropagation()}>
        <div className="crop-title">Фильтр {type === "photo" ? "фото" : "видео"}</div>
        <div className="filter-preview">
          {type === "photo"
            ? <img src={url} alt="" style={{ filter: css }} />
            : <video src={url} style={{ filter: css }} muted loop autoPlay playsInline />}
        </div>
        <div className="filter-list">
          {STYLES.map((s) => (
            <button key={s.id} className={`filter-chip ${sel === s.id ? "on" : ""}`} onClick={() => setSel(s.id)} disabled={busy}>
              <span className="filter-swatch" style={{ filter: s.css }} />
              {s.name}
            </button>
          ))}
        </div>
        <label className="check-row" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} disabled={busy} />
          😊 Разгладить кожу (умное — глаза и детали остаются резкими)
        </label>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Разглаживание применится при сохранении (в превью выше не показано).</div>

        {busy && type === "video" && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Обрабатываю видео… {Math.round(prog * 100)}% (идёт в реальном времени)
          </div>
        )}
        <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
          <button className="btn ghost sm" onClick={onCancel} disabled={busy}>Отмена</button>
          <button className="btn sm" onClick={apply} disabled={busy}>{busy ? "…" : "Применить"}</button>
        </div>
      </div>
    </div>
  );
}
