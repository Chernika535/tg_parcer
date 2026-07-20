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
        // Только быстрый путь t.me/s (пара повторов от троттлинга). MTProto здесь
        // НЕ трогаем — лишние обращения нагружают общий читающий аккаунт и мешают
        // ему читать ленты. Тяжёлый путь — только вручную по кнопке.
        try {
          const list = await channelsInfo([c]);
          const found = list.find((x) => (x.username || "").toLowerCase() === c.toLowerCase());
          if (found && (found.title || found.avatar)) {
            setInfo((p) => ({ ...p, [c]: found }));
            busyRef.current.delete(c);
            return;
          }
        } catch { /* повторим ниже */ }
        const a = (attemptsRef.current[c] = (attemptsRef.current[c] || 0) + 1);
        busyRef.current.delete(c);
        if (a < 3) setTimeout(() => setTick((t) => t + 1), 400);
        else setInfo((p) => ({ ...p, [c]: null }));
      }, delay);
    }
  }, [channels, info, tick]);

  // Ручная проверка канала через MTProto (по кнопке) — точечно, не массово.
  async function recheck(c: string) {
    setInfo((p) => ({ ...p, [c]: undefined }));
    busyRef.current.add(c);
    const mt = await channelInfoMT(c).catch(() => null);
    setInfo((p) => ({ ...p, [c]: mt && (mt.title || mt.avatar) ? mt : null }));
    busyRef.current.delete(c);
  }

  // Массовое добавление: несколько ников/ссылок одним блоком через ; , перенос
  // строки или пробел — сами разложим на каналы.
  function add() {
    const parts = value.split(/[\s;,]+/).map(clean).filter(Boolean) as string[];
    if (!parts.length) return;
    const next = [...channels];
    for (const c of parts) if (!next.includes(c)) next.push(c);
    onChange(next);
    setValue("");
  }

  return (
    <div>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <textarea
          rows={2}
          style={{ flex: 1 }}
          placeholder="@channel или ссылка. Можно сразу много — через ; запятую или с новой строки"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } }}
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
