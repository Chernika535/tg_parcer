import { useMemo, useRef, useState } from "react";
import { cleanTags } from "../lib/data.ts";

// Ввод тегов с автодополнением: при вводе показываем выпадающий список
// подходящих существующих тегов; можно кликнуть или дописать свой и Enter.
// Боксами показываем только ВЫБРАННЫЕ теги (чтобы не занимать кучу места).
export default function TagInput({ tags, onChange, suggestions }: {
  tags: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
}) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const pool = suggestions.filter((t) => !tags.includes(t));
    const list = q ? pool.filter((t) => t.includes(q)) : pool;
    return list.slice(0, 8);
  }, [value, suggestions, tags]);

  function add(raw: string) {
    const next = cleanTags([...tags, raw]);
    onChange(next);
    setValue(""); setHi(0); setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && matches[hi]) add(matches[hi]);
      else if (value.trim()) add(value);
    } else if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div className="tag-input" ref={boxRef}>
      <div className="tag-input-field">
        <input
          type="text"
          value={value}
          placeholder="начните вводить тему…"
          onChange={(e) => { setValue(e.target.value); setOpen(true); setHi(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
        />
        <button type="button" className="btn sm" onClick={() => value.trim() && add(value)}>+</button>

        {open && matches.length > 0 && (
          <div className="tag-drop">
            {matches.map((t, i) => (
              <button
                type="button"
                key={t}
                className={`tag-drop-item ${i === hi ? "hi" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); add(t); }}
                onMouseEnter={() => setHi(i)}
              >
                #{t}
              </button>
            ))}
          </div>
        )}
      </div>

      {tags.length > 0 && (
        <div className="tags" style={{ marginTop: 8 }}>
          {tags.map((t) => (
            <span key={t} className="chip">
              #{t}
              <button type="button" className="chip-x" onClick={() => onChange(tags.filter((x) => x !== t))}>✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
