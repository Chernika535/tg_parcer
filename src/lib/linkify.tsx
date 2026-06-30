import type { ReactNode } from "react";

// Порядок важен: markdown-ссылка [текст](url), затем голый url, затем @упоминание.
const TOKEN_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|((?:https?:\/\/|www\.)[^\s]+)|(@[a-zA-Z][a-zA-Z0-9_]{3,})/g;

// Делает ссылки (в т.ч. ссылки-текстом) и @упоминания кликабельными, сохраняя переносы.
export function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  let key = 0;
  while ((m = TOKEN_RE.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (m[1] && m[2]) {
      nodes.push(<a key={key++} href={m[2]} target="_blank" rel="noreferrer" className="ln">{m[1]}</a>);
    } else if (m[3]) {
      const href = tok.startsWith("www.") ? "https://" + tok : tok;
      nodes.push(<a key={key++} href={href} target="_blank" rel="noreferrer" className="ln">{tok}</a>);
    } else {
      nodes.push(<a key={key++} href={`https://t.me/${tok.slice(1)}`} target="_blank" rel="noreferrer" className="ln">{tok}</a>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Linkify({ text }: { text: string }) {
  return <>{linkify(text)}</>;
}
