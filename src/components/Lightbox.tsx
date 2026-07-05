import { useEffect, useState } from "react";

// Просмотр фото на весь экран: клик по фону/✕ — закрыть, клик по фото — увеличить
// (переключение вписать/натуральный размер), на телефоне работает и пинч-зум.
export default function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label="Закрыть">✕</button>
      <div className={`lightbox-scroll ${zoom ? "zoom" : ""}`} onClick={(e) => e.stopPropagation()}>
        <img
          src={src}
          alt=""
          className={zoom ? "zoom" : ""}
          onClick={() => setZoom((z) => !z)}
        />
      </div>
    </div>
  );
}
