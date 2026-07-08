import type { ReactNode } from "react";

// Короткий текст для маленьких превью: убираем «уродства» разметки — markdown-
// ссылки [текст](url) → текст, голые ссылки и tg://-адреса вырезаем, схлопываем
// пробелы. Остаётся только содержательный текст.
export function plainPreview(text?: string | null): string {
  if (!text) return "";
  return text
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|tg:\/\/|t\.me\/)[^)\s]*\)/gi, "$1") // [текст](url) → текст
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")                                    // прочие [..](..) → текст
    .replace(/(?:https?:\/\/|www\.)\S+/gi, "")                                  // голые ссылки убираем
    .replace(/\bt\.me\/\S+/gi, "")
    .replace(/\btg:\/\/\S+/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
