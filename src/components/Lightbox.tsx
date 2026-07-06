import { useEffect, useRef, useState } from "react";

// Просмотр фото на весь экран с листанием: стрелки/свайп между фото поста,
// клик по фото — увеличить (вписать/натуральный размер), Esc/фон — закрыть.
export default function Lightbox({ images, index, onClose }: { images: string[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index);
  const [zoom, setZoom] = useState(false);
  const touchX = useRef<number | null>(null);
  const many = images.length > 1;

  const go = (d: number) => { setZoom(false); setI((v) => (v + d + images.length) % images.length); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && many) go(-1);
      else if (e.key === "ArrowRight" && many) go(1);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose, many]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label="Закрыть">✕</button>
      {many && <span className="lightbox-count">{i + 1} / {images.length}</span>}
      {many && !zoom && (
        <button className="lightbox-nav prev" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Предыдущее">‹</button>
      )}
      <div
        className={`lightbox-scroll ${zoom ? "zoom" : ""}`}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchX.current == null || zoom) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (many && Math.abs(dx) > 45) go(dx < 0 ? 1 : -1);
          touchX.current = null;
        }}
      >
        <img src={images[i]} alt="" className={zoom ? "zoom" : ""} onClick={() => setZoom((z) => !z)} />
      </div>
      {many && !zoom && (
        <button className="lightbox-nav next" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Следующее">›</button>
      )}
    </div>
  );
}
