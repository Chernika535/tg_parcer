import { useEffect, useRef, useState } from "react";
import { channelsInfo, channelInfoMT, type ChannelInfo } from "../lib/data.ts";

// Принимает @name, t.me/name, ссылку. Нормализация финальная — на бэке.
function clean(input: string): string | null {
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^t\.me\//, "").replace(/^s\//, "").replace(/^@/, "");
  s = s.split(/[/?#]/)[0].replace(/[^a-z0-9_]/g, "");
  return s.length >= 3 ? s : null;
}

export default function ChannelInput({
  channels,
  onChange,
}: {
  channels: string[];
  onChange: (next: string[]) => void;
}) {
  const [value, setValue] = useState("");
  // info[username]: undefined — грузим, null — не найден, объект — найден.
  const [info, setInfo] = useState<Record<string, ChannelInfo | null | undefined>>({});
  const [tick, setTick] = useState(0);
  const busyRef = useRef<Set<string>>(new Set());
  const attemptsRef = useRef<Record<string, number>>({});

  // Подтягиваем аватар/название/ник — КАЖДЫЙ канал отдельным запросом (пачкой
  // Telegram троттлит, и последние каналы приходили пустыми). Пустой/сбойный
  // ответ ретраим несколько раз с задержкой, и только потом помечаем.
  useEffect(() => {
    const missing = channels.filter((c) => info[c] === undefined && !busyRef.current.has(c));
    for (const c of missing) {
      busyRef.current.add(c);
      // Небольшой разброс старта, чтобы не бить в t.me все разом.
      const delay = (attemptsRef.current[c] || 0) * 700 + Math.random() * 300;
      setTimeout(async () => {
        // Сначала быстрый путь (t.me/s), пара повторов от троттлинга.
        try {
          const list = await channelsInfo([c]);
          const found = list.find((x) => (x.username || "").toLowerCase() === c.toLowerCase());
          if (found && (found.title || found.avatar)) {
            setInfo((p) => ({ ...p, [c]: found }));
            busyRef.current.delete(c);
            return;
          }
        } catch { /* попробуем ниже */ }
        const a = (attemptsRef.current[c] = (attemptsRef.current[c] || 0) + 1);
        if (a < 3) { busyRef.current.delete(c); setTimeout(() => setTick((t) => t + 1), 300); return; }
        // Не вышло по t.me/s — пробуем через MTProto (нашу спец-функцию).
        const mt = await channelInfoMT(c).catch(() => null);
        setInfo((p) => ({ ...p, [c]: mt && (mt.title || mt.avatar) ? mt : null }));
        busyRef.current.delete(c);
      }, delay);
    }
  }, [channels, info, tick]);

  // Ручная повторная проверка канала (сбрасываем и пробуем заново, вкл. MTProto).
  function recheck(c: string) {
    attemptsRef.current[c] = 0;
    busyRef.current.delete(c);
    setInfo((p) => ({ ...p, [c]: undefined }));
  }

  function add() {
    const c = clean(value);
    if (!c) return;
    if (!channels.includes(c)) onChange([...channels, c]);
    setValue("");
  }

  return (
    <div>
      <div className="row">
        <input
          type="text"
          placeholder="@channel, t.me/channel или ссылка"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <button type="button" className="btn sm" onClick={add}>+</button>
      </div>

      <div className="chan-cards">
        {channels.map((c) => {
          const it = info[c];
          const loading = it === undefined;
          const notFound = it === null;
          return (
            <div key={c} className={`chan-card ${notFound ? "not-found" : ""}`}>
              {it && it.avatar
                ? <img className="chan-card-ava" src={it.avatar} alt="" />
                : <div className="chan-card-ava ph">{notFound ? "!" : "@"}</div>}
              <div className="chan-card-main">
                <div className="chan-card-title">
                  {loading ? "Проверяю…" : it?.title || (notFound ? "Превью не подгрузилось" : `@${c}`)}
                </div>
                <div className="chan-card-nick">
                  {notFound
                    ? <>@{c} · <button type="button" className="chan-recheck" onClick={() => recheck(c)}>🔄 проверить ещё раз</button></>
                    : `@${c}`}
                </div>
              </div>
              <button type="button" className="chan-card-x" onClick={() => onChange(channels.filter((x) => x !== c))} aria-label="Убрать">✕</button>
            </div>
          );
        })}
        {channels.length === 0 && <span className="muted">Каналы не добавлены</span>}
      </div>
      {channels.length > 0 && (
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          Аватар и название — просто подсказка. Канал всё равно добавится в ленту и будет читаться, даже если превью тут не подгрузилось.
        </div>
      )}
    </div>
  );
}
