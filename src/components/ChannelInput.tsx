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
  const busyRef = useRef<Set<string>>(new Set());

  // Подтягиваем аватар/название/ник для новых каналов.
  useEffect(() => {
    const missing = channels.filter((c) => info[c] === undefined && !busyRef.current.has(c));
    if (missing.length === 0) return;
    missing.forEach((c) => busyRef.current.add(c));
    channelsInfo(missing).then((list) => {
      const byName = new Map(list.map((x) => [(x.username || "").toLowerCase(), x]));
      setInfo((prev) => {
        const next = { ...prev };
        for (const c of missing) {
          const found = byName.get(c.toLowerCase());
          // «Найден», только если реально что-то прочиталось (название или аватар).
          next[c] = found && (found.title || found.avatar) ? found : null;
        }
        return next;
      });
      missing.forEach((c) => busyRef.current.delete(c));
    }).catch(() => {
      setInfo((prev) => { const n = { ...prev }; for (const c of missing) n[c] = null; return n; });
      missing.forEach((c) => busyRef.current.delete(c));
    });
  }, [channels, info]);

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
                  {loading ? "Проверяю…" : it?.title || (notFound ? "Канал не найден" : `@${c}`)}
                </div>
                <div className="chan-card-nick">@{c}{notFound && " · проверьте ник"}</div>
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
