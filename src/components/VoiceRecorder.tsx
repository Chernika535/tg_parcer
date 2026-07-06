import { useEffect, useRef, useState } from "react";
import Recorder from "opus-recorder";

// Запись голосового в OGG/OPUS (Telegram показывает как голосовое, а не файл).
// Есть таймер, пауза/продолжение и визуализация громкости.
function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function VoiceRecorder({ onDone, onCancel }: { onDone: (blob: Blob) => void; onCancel: () => void }) {
  const recRef = useRef<Recorder | null>(null);
  const rafRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const accRef = useRef(0);          // накопленное время до текущего сегмента
  const segStartRef = useRef(0);     // начало текущего сегмента
  const pausedRef = useRef(false);
  const aliveRef = useRef(true);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stopped = false;
    // Часть опций (битрейт/сложность/ограничения дорожки) не описана в типах
    // opus-recorder, но поддерживается в рантайме — поэтому конфиг через any.
    // deno-lint-ignore no-explicit-any
    const recConfig: any = {
      encoderPath: "/encoderWorker.min.js",
      numberOfChannels: 1,
      encoderApplication: 2048, // VOIP — как голосовые в Telegram
      encoderSampleRate: 48000,
      encoderBitRate: 32000,    // чётче и громче, чем дефолт
      encoderComplexity: 10,    // максимальное качество кодека
      streamPages: false,
      // Чистим шум/эхо и авто-выравниваем громкость — голос слышно ровно и ясно.
      mediaTrackConstraints: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    };
    const rec = new Recorder(recConfig);
    recRef.current = rec;
    rec.ondataavailable = (data: Uint8Array) => {
      if (stopped) return;
      stopped = true;
      onDone(new Blob([data], { type: "audio/ogg" }));
    };
    rec.start().then(() => {
      segStartRef.current = Date.now();
      setReady(true);
      // Визуализация громкости.
      const analyser = rec.audioContext.createAnalyser();
      analyser.fftSize = 256;
      rec.sourceNode.connect(analyser);
      analyserRef.current = analyser;
      draw();
      tick();
    }).catch((e) => setError("Нет доступа к микрофону: " + (e as Error).message));

    return () => {
      aliveRef.current = false;
      cancelAnimationFrame(rafRef.current);
      try { recRef.current?.close(); } catch { /* noop */ }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function tick() {
    if (!aliveRef.current) return;
    setElapsed(pausedRef.current ? accRef.current : accRef.current + (Date.now() - segStartRef.current));
    setTimeout(tick, 200);
  }

  function draw() {
    const cv = canvasRef.current, an = analyserRef.current;
    if (!cv || !an) return;
    const ctx = cv.getContext("2d")!;
    const buf = new Uint8Array(an.frequencyBinCount);
    const loop = () => {
      an.getByteFrequencyData(buf);
      ctx.clearRect(0, 0, cv.width, cv.height);
      const bars = 32, step = Math.floor(buf.length / bars);
      const bw = cv.width / bars;
      ctx.fillStyle = "#ff2ea6";
      for (let i = 0; i < bars; i++) {
        const v = buf[i * step] / 255;
        const h = Math.max(3, v * cv.height);
        ctx.fillRect(i * bw + 1, (cv.height - h) / 2, bw - 2, h);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
  }

  function togglePause() {
    const rec = recRef.current;
    if (!rec) return;
    if (paused) {
      rec.resume();
      segStartRef.current = Date.now();
      pausedRef.current = false;
      setPaused(false);
    } else {
      rec.pause();
      accRef.current += Date.now() - segStartRef.current;
      pausedRef.current = true;
      setPaused(true);
    }
  }
  function finish() {
    aliveRef.current = false;
    cancelAnimationFrame(rafRef.current);
    try { recRef.current?.stop(); } catch { /* ondataavailable отдаст blob */ }
  }
  function cancel() {
    aliveRef.current = false;
    cancelAnimationFrame(rafRef.current);
    try { recRef.current?.close(); } catch { /* noop */ }
    recRef.current = null;
    onCancel();
  }

  if (error) return <div className="card" style={{ fontSize: 13 }}>{error} <button className="btn ghost sm" onClick={onCancel}>Закрыть</button></div>;

  return (
    <div className="voice-rec">
      <span className={`rec-dot ${paused ? "paused" : ""}`} />
      <span className="rec-time">{fmt(elapsed)}</span>
      <canvas ref={canvasRef} className="rec-wave" width={160} height={32} />
      <button type="button" className="btn ghost sm" onClick={togglePause} disabled={!ready}>{paused ? "▶" : "⏸"}</button>
      <button type="button" className="btn sm" onClick={finish} disabled={!ready}>Готово</button>
      <button type="button" className="btn ghost sm" onClick={cancel}>✕</button>
    </div>
  );
}
