// Стилевые фильтры для фото/видео/кружочков. Реализованы как CSS-фильтры,
// которые «запекаются» в файл через canvas (то есть уходят в Telegram уже
// применёнными). Задача — чтобы посты выглядели дорого и стильно, как у глянца.

export type StyleId = "none" | "glossy" | "film" | "retro" | "cinema" | "bw";

export const STYLES: { id: StyleId; name: string; css: string }[] = [
  { id: "none", name: "Оригинал", css: "none" },
  { id: "glossy", name: "Глянец", css: "saturate(1.5) contrast(1.16) brightness(1.05)" },
  { id: "film", name: "Плёнка", css: "sepia(0.22) saturate(1.12) contrast(0.94) brightness(1.06) hue-rotate(-8deg)" },
  { id: "retro", name: "Ретро", css: "sepia(0.4) saturate(1.2) contrast(1.06) brightness(1.04) hue-rotate(-14deg)" },
  { id: "cinema", name: "Кинема", css: "saturate(1.35) contrast(1.12) hue-rotate(10deg) brightness(0.98)" },
  { id: "bw", name: "Ч/Б", css: "grayscale(1) contrast(1.12) brightness(1.04)" },
];

export function styleCss(id: StyleId): string {
  return STYLES.find((s) => s.id === id)?.css ?? "none";
}

export function pickVideoMime(): string {
  const cands = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4",
    "video/webm;codecs=h264", "video/webm;codecs=vp9,opus", "video/webm",
  ];
  const MR = typeof MediaRecorder !== "undefined" ? MediaRecorder : null;
  for (const c of cands) if (MR && MR.isTypeSupported(c)) return c;
  return "";
}

// Запекаем фильтр в изображение через canvas → новый JPEG.
export async function bakeImage(blob: Blob, css: string): Promise<Blob> {
  if (!css || css === "none") return blob;
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("не удалось прочитать фото")); i.src = url;
    });
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext("2d")!;
    ctx.filter = css;
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("не удалось сохранить"))), "image/jpeg", 0.92));
  } finally { URL.revokeObjectURL(url); }
}

// Запекаем фильтр в видео: проигрываем, рисуем каждый кадр с фильтром в canvas,
// пишем через MediaRecorder. Звук берём беззвучно через WebAudio. Идёт в реальном
// времени (сколько длится ролик — столько и обработка).
export async function bakeVideo(blob: Blob, css: string, onProgress?: (p: number) => void): Promise<Blob> {
  if (!css || css === "none") return blob;
  if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream) return blob;

  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.src = url; v.playsInline = true; v.muted = false; v.preload = "auto";
  try {
    await new Promise<void>((res, rej) => {
      v.onloadedmetadata = () => res();
      v.onerror = () => rej(new Error("не удалось прочитать видео"));
    });
    const scale = Math.min(1, 720 / Math.max(v.videoWidth || 720, v.videoHeight || 720));
    const W = Math.round((v.videoWidth || 720) * scale);
    const H = Math.round((v.videoHeight || 720) * scale);
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d")!;
    const stream = cv.captureStream(30);

    // Звук — через WebAudio, не выводя на динамик (тихая обработка).
    let actx: AudioContext | null = null;
    try {
      // deno-lint-ignore no-explicit-any
      const AC = (window.AudioContext || (window as any).webkitAudioContext);
      actx = new AC();
      const srcNode = actx.createMediaElementSource(v);
      const dest = actx.createMediaStreamDestination();
      srcNode.connect(dest);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch { /* без звука */ }

    const mime = pickVideoMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 3_000_000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise<Blob>((res) => { rec.onstop = () => res(new Blob(chunks, { type: rec.mimeType || mime || "video/mp4" })); });

    let raf = 0;
    const draw = () => {
      ctx.filter = css;
      ctx.drawImage(v, 0, 0, W, H);
      if (onProgress && v.duration) onProgress(Math.min(1, v.currentTime / v.duration));
      raf = requestAnimationFrame(draw);
    };

    rec.start();
    await v.play();
    draw();
    await new Promise<void>((res) => { v.onended = () => res(); });
    cancelAnimationFrame(raf);
    rec.stop();
    const out = await done;
    try { await actx?.close(); } catch { /* ignore */ }
    return out;
  } finally { URL.revokeObjectURL(url); }
}
