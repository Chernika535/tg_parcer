import { useEffect, useRef, useState } from "react";
import { channelsInfo, type ChannelInfo } from "../lib/data.ts";

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

  // Подтягиваем аватар/название/ник для новых каналов.
  useEffect(() => {
    const missing = channels.filter((c) => info[c] === undefined && !busyRef.current.has(c));
    if (missing.length === 0) return;
    missing.forEach((c) => busyRef.current.add(c));
    channelsInfo(missing).then((list) => {
      const byName = new Map(list.map((x) => [(x.username || "").toLowerCase(), x]));
      // Пустой ответ, скорее всего, сетевой сбой (связь без VPN бывает нестабильна)
      // — не помечаем каналы «не найдены» сразу, делаем пару повторов.
      const networkFail = list.length === 0;
      const retry: string[] = [];
      setInfo((prev) => {
        const next = { ...prev };
        for (const c of missing) {
          const found = byName.get(c.toLowerCase());
          // «Читается», только если реально получили название или аватар. Пустой
          // ответ на канал = его нельзя прочитать (опечатка, удалён или нет
          // публичного превью) — помечаем предупреждением.
          if (found && (found.title || found.avatar)) { next[c] = found; continue; }
          const a = (attemptsRef.current[c] = (attemptsRef.current[c] || 0) + 1);
          if (networkFail && a < 3) retry.push(c);      // повторим позже
          else next[c] = null;                          // не читается
        }
        return next;
      });
      missing.forEach((c) => busyRef.current.delete(c));
      if (retry.length) setTimeout(() => setTick((t) => t + 1), 1500);
    }).catch(() => {
      const retry: string[] = [];
      setInfo((prev) => {
        const next = { ...prev };
        for (const c of missing) {
          const a = (attemptsRef.current[c] = (attemptsRef.current[c] || 0) + 1);
          if (a < 3) retry.push(c); else next[c] = null;
        }
        return next;
      });
      missing.forEach((c) => busyRef.current.delete(c));
      if (retry.length) setTimeout(() => setTick((t) => t + 1), 1500);
    });
  }, [channels, info, tick]);

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
                  {loading ? "Проверяю…" : it?.title || (notFound ? "Не удалось прочитать канал" : `@${c}`)}
                </div>
                <div className="chan-card-nick">
                  {notFound ? "проверьте ник — или у канала нет публичного превью" : `@${c}`}
                </div>
              </div>
              <button type="button" className="chan-card-x" onClick={() => onChange(channels.filter((x) => x !== c))} aria-label="Убрать">✕</button>
            </div>
          );
        })}
        {channels.length === 0 && <span className="muted">Каналы не добавлены</span>}
      </div>
    </div>
  );
}
