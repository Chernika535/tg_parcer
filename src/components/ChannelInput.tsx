import { useState } from "react";

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
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn sm" onClick={add}>
          +
        </button>
      </div>
      <div className="tags">
        {channels.map((c) => (
          <span key={c} className="tag">
            @{c}
            <button type="button" onClick={() => onChange(channels.filter((x) => x !== c))}>
              ✕
            </button>
          </span>
        ))}
        {channels.length === 0 && <span className="muted">Каналы не добавлены</span>}
      </div>
    </div>
  );
}
