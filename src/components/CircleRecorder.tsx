import { useEffect, useRef, useState } from "react";
import { STYLES, styleCss, type StyleId } from "../lib/filters.ts";
import { smoothSkin } from "../lib/skin.ts";

// Запись «кружочка» (видео-заметки Telegram): квадрат ≤60с.
// Пишем с canvas (центр-квадрат камеры) через MediaRecorder — это надёжнее
// WebCodecs на телефонах. Камеру можно менять даже во время записи: запись идёт
// с холста, а смена камеры лишь меняет источник, который в холст рисуется.
const SIZE = 400;
const FPS = 30;
const MAX_MS = 59_000;

// Выбираем лучший поддерживаемый контейнер: Telegram-кружок любит mp4/H.264.
function pickMime(): string {
  const cands = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=h264",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ];
  const MR = typeof MediaRecorder !== "undefined" ? MediaRecorder : null;
  for (const c of cands) if (MR && MR.isTypeSupported(c)) return c;
  return "";
}

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function CircleRecorder({ onDone, onCancel }: { onDone: (blob: Blob) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioTrackRef = useRef<MediaStreamTrack | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number>(0);
  const startRef = useRef(0);
  const facingRef = useRef<"user" | "environment">("user");
  const camsRef = useRef<MediaDeviceInfo[]>([]);
  const camIdxRef = useRef(0);
  const softRef = useRef<HTMLCanvasElement | null>(null); // офскрин для мягкого свечения

  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [beauty, setBeauty] = useState(false);
  const beautyRef = useRef(false);
  beautyRef.current = beauty;
  const [skin, setSkin] = useState(true);
  const skinRef = useRef(true);
  skinRef.current = skin;
  const [style, setStyle] = useState<StyleId>("none");
  const styleRef = useRef<StyleId>("none");
  styleRef.current = style;
  const styleName = STYLES.find((s) => s.id === style)?.name ?? "Оригинал";

  const supported = typeof MediaRecorder !== "undefined"
    && typeof HTMLCanvasElement !== "undefined"
    && !!HTMLCanvasElement.prototype.captureStream;

  function attach(stream: MediaStream) {
    videoStreamRef.current = stream;
    if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); }
  }

  useEffect(() => {
    if (!supported) { setError("Ваш браузер не умеет записывать кружочки. Снимите его в Telegram или откройте сайт в Chrome на Android."); return; }
    let alive = true;
    (async () => {
      try {
        const a = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioTrackRef.current = a.getAudioTracks()[0] ?? null;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "user" }, width: { ideal: 720 }, height: { ideal: 720 } }, audio: false,
        });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        attach(stream);
        // Список камер (доступен после выдачи прав) — для надёжного переключения.
        try {
          const devs = await navigator.mediaDevices.enumerateDevices();
          camsRef.current = devs.filter((d) => d.kind === "videoinput");
          const curId = stream.getVideoTracks()[0].getSettings().deviceId;
          const i = camsRef.current.findIndex((d) => d.deviceId === curId);
          camIdxRef.current = i >= 0 ? i : 0;
        } catch { /* ignore */ }
        drawLoop();
      } catch (e) { setError("Нет доступа к камере/микрофону: " + (e as Error).message); }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      clearInterval(tickRef.current);
      try { recRef.current?.state !== "inactive" && recRef.current?.stop(); } catch { /* ignore */ }
      videoStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioTrackRef.current?.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Рисуем центр-квадрат камеры в canvas (постоянно — и превью, и источник записи).
  function drawLoop() {
    const cv = canvasRef.current, v = videoRef.current;
    if (!cv || !v) return;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    // Офскрин для «мягкого свечения» (soft-focus): размытую копию накладываем
    // поверх резкой — кожа выглядит гладкой, а картинка мягкой и стильной.
    if (!softRef.current) { softRef.current = document.createElement("canvas"); softRef.current.width = SIZE; softRef.current.height = SIZE; }
    const soft = softRef.current;
    const sctx = soft.getContext("2d")!;

    // Применить CSS-фильтр к текущему кадру «на месте» (через офскрин-копию).
    const gradeInPlace = (css: string) => {
      sctx.clearRect(0, 0, SIZE, SIZE);
      sctx.drawImage(cv, 0, 0);
      ctx.save();
      ctx.filter = css;
      ctx.drawImage(soft, 0, 0);
      ctx.restore();
    };

    let frame = 0;
    const loop = () => {
      if (v.videoWidth) {
        const s = Math.min(v.videoWidth, v.videoHeight);
        const sx = (v.videoWidth - s) / 2, sy = (v.videoHeight - s) / 2;
        const mirror = facingRef.current === "user";

        // 1) Базовый кадр (зеркалим фронталку).
        ctx.save();
        if (mirror) { ctx.translate(SIZE, 0); ctx.scale(-1, 1); }
        ctx.drawImage(v, sx, sy, s, s, 0, 0, SIZE, SIZE);
        ctx.restore();

        // 2) Умное разглаживание кожи (только телесные пиксели). Тяжёлое —
        //    делаем через кадр, чтобы не ронять частоту записи.
        if (skinRef.current) { frame++; if (frame % 2 === 0) smoothSkin(cv, 0.85); }

        // 3) «Мягкое свечение» (дымка/glow) — по желанию, отдельной кнопкой.
        if (beautyRef.current) {
          sctx.clearRect(0, 0, SIZE, SIZE);
          sctx.filter = "blur(8px) brightness(1.06) saturate(1.12)";
          sctx.drawImage(cv, 0, 0);
          sctx.filter = "none";
          ctx.save(); ctx.globalAlpha = 0.35; ctx.drawImage(soft, 0, 0); ctx.restore();
          ctx.save(); ctx.globalAlpha = 0.16; ctx.globalCompositeOperation = "screen"; ctx.drawImage(soft, 0, 0); ctx.restore();
          gradeInPlace("brightness(1.05) contrast(1.04) saturate(1.18) sepia(0.04) hue-rotate(-4deg)");
        }

        // 4) Стилевой фильтр (глянец/плёнка/…).
        const scss = styleCss(styleRef.current);
        if (scss !== "none") gradeInPlace(scss);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
  }

  facingRef.current = facing; // drawLoop (замыкание) должен видеть актуальную камеру

  // Многие телефоны НЕ дают открыть вторую камеру, пока активна первая, поэтому
  // сначала гасим текущую, затем включаем следующую (по deviceId — надёжнее, чем
  // facingMode). Если не вышло — пробуем вернуть рабочую камеру.
  async function switchCamera() {
    const cams = camsRef.current;
    const prev = videoStreamRef.current;
    prev?.getVideoTracks().forEach((t) => t.stop());
    videoStreamRef.current = null;
    try {
      let stream: MediaStream;
      if (cams.length > 1) {
        camIdxRef.current = (camIdxRef.current + 1) % cams.length;
        const id = cams[camIdxRef.current].deviceId;
        stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: id }, width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
      } else {
        const next = facing === "user" ? "environment" : "user";
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: next } }, audio: false });
      }
      attach(stream);
      const fm = stream.getVideoTracks()[0].getSettings().facingMode;
      setFacing(fm === "environment" ? "environment" : fm === "user" ? "user" : (facing === "user" ? "environment" : "user"));
    } catch (e) {
      // Возвращаем предыдущую камеру, чтобы экран не остался чёрным.
      try {
        const back = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
        attach(back);
      } catch { /* ignore */ }
      setError("Не удалось переключить камеру: " + (e as Error).message);
    }
  }

  function start() {
    if (!canvasRef.current) return;
    if (!audioTrackRef.current) { setError("Нет доступа к микрофону"); return; }
    setError("");
    const mime = pickMime();
    // Поток записи — из холста + звук микрофона.
    const stream = (canvasRef.current as HTMLCanvasElement).captureStream(FPS);
    stream.addTrack(audioTrackRef.current);
    let rec: MediaRecorder;
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 1_500_000 } : undefined); }
    catch (e) { setError("Запись не поддерживается: " + (e as Error).message); return; }
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const type = rec.mimeType || mime || "video/mp4";
      const blob = new Blob(chunksRef.current, { type });
      setBusy(false);
      onDone(blob);
    };
    recRef.current = rec;
    rec.start();
    startRef.current = performance.now();
    setRecording(true);
    tickRef.current = window.setInterval(() => {
      const ms = performance.now() - startRef.current;
      setElapsed(ms);
      if (ms >= MAX_MS) stop();
    }, 200);
  }

  function stop() {
    if (!recRef.current || recRef.current.state === "inactive") return;
    clearInterval(tickRef.current);
    setRecording(false);
    setBusy(true);
    try { recRef.current.stop(); } catch (e) { setError("Не удалось остановить запись: " + (e as Error).message); setBusy(false); }
  }

  function cancel() {
    clearInterval(tickRef.current);
    cancelAnimationFrame(rafRef.current);
    try { recRef.current?.state !== "inactive" && recRef.current?.stop(); } catch { /* ignore */ }
    videoStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioTrackRef.current?.stop();
    onCancel();
  }

  const pct = Math.min(100, (elapsed / MAX_MS) * 100);

  return (
    <div className="circ-overlay">
      <video ref={videoRef} playsInline muted style={{ display: "none" }} />
      <button className="circ-close" onClick={cancel} aria-label="Закрыть">✕</button>

      <div className="circ-title">Кружочек</div>

      <div className="circ-stage">
        <svg className="circ-ring" viewBox="0 0 100 100" aria-hidden>
          <circle className="circ-ring-bg" cx="50" cy="50" r="47" />
          <circle className="circ-ring-fg" cx="50" cy="50" r="47" pathLength={100}
            style={{ strokeDasharray: 100, strokeDashoffset: 100 - pct }} />
        </svg>
        <canvas ref={canvasRef} width={SIZE} height={SIZE} className="circ-canvas" />
      </div>

      {error ? (
        <div className="circ-error">{error}<br /><button className="btn secondary sm" style={{ marginTop: 10 }} onClick={cancel}>Закрыть</button></div>
      ) : (
        <>
          <div className="circ-timer">{recording ? fmt(elapsed) : "до 60 сек"}{style !== "none" && <span className="circ-style"> · {styleName}</span>}</div>
          <div className="circ-controls">
            <button className={`circ-btn secondary ${skin ? "on" : ""}`} onClick={() => setSkin((v) => !v)} disabled={busy} title="Умное разглаживание кожи (глаза и детали резкие)">😊</button>
            <button className={`circ-btn secondary ${beauty ? "on" : ""}`} onClick={() => setBeauty((v) => !v)} disabled={busy} title="Мягкое свечение (дымка)">✨</button>
            <button className={`circ-btn secondary ${style !== "none" ? "on" : ""}`} onClick={() => {
              const ids = STYLES.map((s) => s.id);
              setStyle(ids[(ids.indexOf(style) + 1) % ids.length]);
            }} disabled={busy} title={`Стиль: ${styleName}`}>🎨</button>
            <button className="circ-btn secondary" onClick={switchCamera} disabled={busy} title="Сменить камеру">🔄</button>
            {!recording && !busy && <button className="circ-rec" onClick={start} aria-label="Запись" />}
            {recording && <button className="circ-stop" onClick={stop} aria-label="Стоп" />}
            {busy && <span className="circ-saving">Собираю…</span>}
            <button className="circ-btn secondary" onClick={cancel} disabled={busy} title="Отмена">✕</button>
          </div>
          <div className="circ-hint">Что видите в кружке — то и уйдёт в канал. Камеру можно менять и во время записи.</div>
        </>
      )}
    </div>
  );
}
