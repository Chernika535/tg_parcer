import { useEffect, useRef, useState } from "react";
import { STYLES, styleCss, bakeImage, bakeVideo, type StyleId } from "../lib/filters.ts";
import { smoothSkin } from "../lib/skin.ts";

const MAXSIDE = 640; // максимальная сторона канваса превью

// Живое превью «как получится»: рисуем медиа в canvas в ЕГО пропорциях (не режем
// в квадрат) с выбранным фильтром и разглаживанием — виден реальный итог.
function LivePreview({ type, url, css, smooth }: { type: "photo" | "video"; url: string; css: string; smooth: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ css, smooth });
  stateRef.current = { css, smooth };

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    let raf = 0, stopped = false;

    const fit = (w: number, h: number) => {
      const k = Math.min(1, MAXSIDE / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * k)), chh = Math.max(1, Math.round(h * k));
      if (cv.width !== cw || cv.height !== chh) { cv.width = cw; cv.height = chh; }
    };
    const drawFrom = (src: CanvasImageSource, w: number, h: number) => {
      if (!w || !h) return;
      fit(w, h);
      ctx.filter = stateRef.current.css && stateRef.current.css !== "none" ? stateRef.current.css : "none";
      ctx.drawImage(src, 0, 0, cv.width, cv.height);
      ctx.filter = "none";
      if (stateRef.current.smooth) smoothSkin(cv, 0.45);
    };

    if (type === "photo") {
      const img = new Image();
      img.onload = () => { if (!stopped) drawFrom(img, img.naturalWidth, img.naturalHeight); };
      img.src = url;
      const iv = setInterval(() => { if (img.complete && img.naturalWidth) drawFrom(img, img.naturalWidth, img.naturalHeight); }, 200);
      return () => { stopped = true; clearInterval(iv); };
    }
    const vid = document.createElement("video");
    vid.src = url; vid.muted = true; vid.loop = true; vid.playsInline = true;
    vid.play().catch(() => {});
    const loop = () => {
      if (stopped) return;
      if (vid.videoWidth) drawFrom(vid, vid.videoWidth, vid.videoHeight);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { stopped = true; cancelAnimationFrame(raf); vid.pause(); };
  }, [url, type]);

  return <canvas ref={canvasRef} className="filter-canvas" />;
}

// Выбор стилевого фильтра для загруженного фото/видео. По «Применить» запекаем
// фильтр (и разглаживание) в файл.
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
          <LivePreview type={type} url={url} css={css} smooth={smooth} />
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
