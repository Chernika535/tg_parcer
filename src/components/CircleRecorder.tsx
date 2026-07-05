import { useEffect, useRef, useState } from "react";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";

// Типы WebCodecs (AudioEncoder/AudioData) отсутствуют в стандартной lib TS.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const AudioEncoder: any;
type AudioData = any;

// Запись «кружочка» (видео-заметки Telegram): квадрат, mp4/H.264+AAC, ≤60с.
// Пишем кадры с canvas (обрезка по центру в квадрат) через WebCodecs, звук — из
// микрофона, склеиваем в mp4. Круглое превью — как выйдет в Telegram.
const SIZE = 400;          // сторона квадрата
const FPS = 30;
const MAX_MS = 59_000;
const supported = typeof window !== "undefined"
  && "VideoEncoder" in window && "AudioEncoder" in window && "MediaStreamTrackProcessor" in window;

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
  const drawTimerRef = useRef<number>(0);

  // Пайплайн кодирования
  const muxerRef = useRef<Muxer<ArrayBufferTarget> | null>(null);
  const vEncRef = useRef<VideoEncoder | null>(null);
  const aEncRef = useRef<any>(null);
  const aReaderRef = useRef<ReadableStreamDefaultReader<AudioData> | null>(null);
  const startRef = useRef(0);
  const frameNRef = useRef(0);
  const recordingRef = useRef(false);

  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Захват выбранной камеры (только видео — аудио берём один раз отдельно).
  async function startCamera(f: "user" | "environment") {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: f, width: 640, height: 640 }, audio: false });
    videoStreamRef.current?.getTracks().forEach((t) => t.stop());
    videoStreamRef.current = stream;
    if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
  }

  useEffect(() => {
    if (!supported) { setError("Ваш браузер не умеет записывать кружочки. Снимите его в Telegram или откройте сайт в Chrome на Android."); return; }
    let alive = true;
    (async () => {
      try {
        const a = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioTrackRef.current = a.getAudioTracks()[0] ?? null;
        await startCamera("user");
        if (!alive) return;
        drawLoop();
      } catch (e) { setError("Нет доступа к камере/микрофону: " + (e as Error).message); }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      clearInterval(drawTimerRef.current);
      videoStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioTrackRef.current?.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Рисуем центр-квадрат камеры в canvas (постоянно, и для превью, и для записи).
  function drawLoop() {
    const cv = canvasRef.current, v = videoRef.current;
    if (!cv || !v) return;
    const ctx = cv.getContext("2d")!;
    const loop = () => {
      if (v.videoWidth) {
        const s = Math.min(v.videoWidth, v.videoHeight);
        const sx = (v.videoWidth - s) / 2, sy = (v.videoHeight - s) / 2;
        ctx.drawImage(v, sx, sy, s, s, 0, 0, SIZE, SIZE);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
  }

  async function switchCamera() {
    const next = facing === "user" ? "environment" : "user";
    setFacing(next);
    try { await startCamera(next); } catch (e) { setError("Не удалось переключить камеру: " + (e as Error).message); }
  }

  async function start() {
    if (!audioTrackRef.current) { setError("Нет микрофона"); return; }
    setError("");
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      fastStart: "in-memory",
      video: { codec: "avc", width: SIZE, height: SIZE },
      audio: { codec: "aac", numberOfChannels: 1, sampleRate: 48000 },
    });
    muxerRef.current = muxer;

    const vEnc = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => setError("Кодек видео: " + e.message),
    });
    vEnc.configure({ codec: "avc1.42001f", width: SIZE, height: SIZE, bitrate: 1_200_000, framerate: FPS });
    vEncRef.current = vEnc;

    const aEnc = new AudioEncoder({
      output: (chunk: any, meta: any) => muxer.addAudioChunk(chunk, meta),
      error: (e: any) => setError("Кодек аудио: " + e.message),
    });
    aEnc.configure({ codec: "mp4a.40.2", numberOfChannels: 1, sampleRate: 48000, bitrate: 96_000 });
    aEncRef.current = aEnc;

    // Аудио из микрофона через процессор дорожки.
    // deno-lint-ignore no-explicit-any
    const proc = new (window as any).MediaStreamTrackProcessor({ track: audioTrackRef.current });
    const reader = proc.readable.getReader() as ReadableStreamDefaultReader<AudioData>;
    aReaderRef.current = reader;
    (async () => {
      while (recordingRef.current) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        try { aEnc.encode(value); } finally { value.close(); }
      }
    })();

    // Видео-кадры с canvas на фиксированной частоте.
    startRef.current = performance.now();
    frameNRef.current = 0;
    recordingRef.current = true;
    setRecording(true);
    drawTimerRef.current = window.setInterval(() => {
      if (!recordingRef.current || !canvasRef.current) return;
      const ts = Math.round((performance.now() - startRef.current) * 1000); // мкс
      setElapsed(ts / 1000);
      if (ts / 1000 >= MAX_MS) { stop(); return; }
      const frame = new VideoFrame(canvasRef.current, { timestamp: ts });
      const keyFrame = frameNRef.current % (FPS * 2) === 0;
      try { vEnc.encode(frame, { keyFrame }); } finally { frame.close(); }
      frameNRef.current++;
    }, 1000 / FPS);
  }

  async function stop() {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    setBusy(true);
    clearInterval(drawTimerRef.current);
    try {
      try { await aReaderRef.current?.cancel(); } catch { /* ignore */ }
      await vEncRef.current?.flush();
      await aEncRef.current?.flush();
      muxerRef.current?.finalize();
      const buf = muxerRef.current!.target.buffer;
      onDone(new Blob([buf], { type: "video/mp4" }));
    } catch (e) {
      setError("Не удалось собрать кружок: " + (e as Error).message);
      setBusy(false);
    }
  }

  function cancel() {
    recordingRef.current = false;
    clearInterval(drawTimerRef.current);
    cancelAnimationFrame(rafRef.current);
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
          <div className="circ-timer">{recording ? fmt(elapsed) : "до 60 сек"}</div>
          <div className="circ-controls">
            <button className="circ-btn secondary" onClick={switchCamera} disabled={recording || busy} title="Сменить камеру">🔄</button>
            {!recording && !busy && <button className="circ-rec" onClick={start} aria-label="Запись" />}
            {recording && <button className="circ-stop" onClick={stop} aria-label="Стоп" />}
            {busy && <span className="circ-saving">Собираю…</span>}
            <button className="circ-btn secondary" onClick={cancel} disabled={busy} title="Отмена">✕</button>
          </div>
          <div className="circ-hint">Что видите в кружке — то и уйдёт в канал</div>
        </>
      )}
    </div>
  );
}
