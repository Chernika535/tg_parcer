import { useEffect, useRef, useState } from "react";

// Кадрирование обложки: тянем пальцем/мышью, зум ползунком. Рамка — ровно в той
// пропорции (5:3), в которой обложка показывается в приложении, поэтому «что
// видно в рамке — то и будет». На выходе — обрезанный PNG нужного размера.
const RATIO = 2 / 5;          // высота / ширина — широкий баннер, как в ленте
export const TARGET_W = 1000;
export const TARGET_H = Math.round(TARGET_W * RATIO); // 400

export default function CoverCropper({ file, onDone, onCancel }: {
  file: Blob; onDone: (blob: Blob) => void; onCancel: () => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [url] = useState(() => URL.createObjectURL(file));
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [frameW, setFrameW] = useState(300);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // смещение картинки в px рамки
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const frameH = frameW * RATIO;

  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  useEffect(() => {
    const im = new Image();
    im.onload = () => { imgRef.current = im; setNat({ w: im.naturalWidth, h: im.naturalHeight }); };
    im.src = url;
  }, [url]);
  useEffect(() => {
    const upd = () => { if (frameRef.current) setFrameW(frameRef.current.clientWidth); };
    upd();
    window.addEventListener("resize", upd);
    return () => window.removeEventListener("resize", upd);
  }, []);

  // Базовый масштаб — чтобы картинка покрывала рамку при zoom=1.
  const base = nat ? Math.max(frameW / nat.w, frameH / nat.h) : 1;
  const dispW = nat ? nat.w * base * zoom : frameW;
  const dispH = nat ? nat.h * base * zoom : frameH;

  // Держим картинку так, чтобы она всегда покрывала рамку.
  function clamp(x: number, y: number) {
    const minX = frameW - dispW, minY = frameH - dispH;
    return { x: Math.min(0, Math.max(minX, x)), y: Math.min(0, Math.max(minY, y)) };
  }
  // При смене зума пере-зажимаем позицию.
  useEffect(() => { setPos((p) => clamp(p.x, p.y)); }, [zoom, frameW, nat]); // eslint-disable-line

  function onDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
  }
  function onMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const nx = drag.current.px + (e.clientX - drag.current.x);
    const ny = drag.current.py + (e.clientY - drag.current.y);
    setPos(clamp(nx, ny));
  }
  function onUp() { drag.current = null; }

  function confirm() {
    if (!imgRef.current || !nat) return;
    const k = TARGET_W / frameW; // масштаб рамка → целевой размер
    const cv = document.createElement("canvas");
    cv.width = TARGET_W; cv.height = TARGET_H;
    const ctx = cv.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(imgRef.current, pos.x * k, pos.y * k, dispW * k, dispH * k);
    cv.toBlob((b) => { if (b) onDone(b); }, "image/png");
  }

  return (
    <div className="crop-overlay" onClick={onCancel}>
      <div className="crop-box" onClick={(e) => e.stopPropagation()}>
        <div className="crop-title">Кадрирование обложки</div>
        <div ref={frameRef} className="crop-frame"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {nat && (
            <img src={url} alt="" draggable={false} style={{
              position: "absolute", left: pos.x, top: pos.y, width: dispW, height: dispH, maxWidth: "none",
            }} />
          )}
          <div className="crop-mask" />
        </div>
        <label style={{ marginTop: 10 }}>Масштаб
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        </label>
        <div className="muted" style={{ fontSize: 12 }}>
          Двигайте фото пальцем, регулируйте масштаб. Рекомендуемый размер — {TARGET_W}×{TARGET_H} px (5:3).
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
          <button className="btn ghost sm" onClick={onCancel}>Отмена</button>
          <button className="btn sm" onClick={confirm}>Готово</button>
        </div>
      </div>
    </div>
  );
}
