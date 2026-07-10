import { useEffect, useRef, useState } from "react";

// Визуальный редактор поста: показывает форматирование как в Telegram и отдаёт
// готовый HTML (parse_mode=HTML). Внутри — contentEditable + execCommand.
const ALLOWED: Record<string, string> = {
  B: "b", STRONG: "b", I: "i", EM: "i", U: "u",
  S: "s", STRIKE: "s", DEL: "s", CODE: "code", PRE: "pre", A: "a",
  BLOCKQUOTE: "blockquote",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// DOM → Telegram-совместимый HTML (только разрешённые теги, переносы строк).
function serialize(node: Node): string {
  let out = "";
  node.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += esc(n.textContent || "");
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as HTMLElement;
      if (el.tagName === "BR") { out += "\n"; return; }
      const spoiler = el.classList.contains("tg-spoiler") || el.dataset.spoiler === "1";
      const inner = serialize(el);
      const isBlock = el.tagName === "DIV" || el.tagName === "P";
      if (spoiler) { out += `<span class="tg-spoiler">${inner}</span>`; return; }
      const tag = ALLOWED[el.tagName];
      if (tag === "a") {
        const href = (el.getAttribute("href") || "").replace(/"/g, "&quot;");
        out += href ? `<a href="${href}">${inner}</a>` : inner;
      } else if (tag === "blockquote") {
        // Цитата — блочный элемент: отделяем переводом строки от предыдущего текста.
        out += (out && !out.endsWith("\n") ? "\n" : "") + `<blockquote>${inner}</blockquote>`;
      } else if (tag) {
        out += `<${tag}>${inner}</${tag}>`;
      } else {
        out += (isBlock && out && !out.endsWith("\n") ? "\n" : "") + inner;
      }
    }
  });
  return out;
}

// Подпись кликабельного слова по типу ссылки нашего сервиса.
function labelForUrl(url: string): string {
  if (/\/post\//.test(url)) return "пост";
  if (/\/feed\//.test(url)) return "лента";
  if (/\/channel\//.test(url)) return "канал";
  return "ссылка";
}
// Ссылка на наш сервис (пост/лента/канал) — для авто-подстановки при вставке.
function isServiceUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.origin !== location.origin) return false;
    return /\/(post|feed|channel)\//.test(u.pathname + u.hash);
  } catch { return false; }
}

export default function RichEditor({
  onChange, placeholder, initialHtml, mentions = [],
}: {
  onChange: (html: string) => void;
  placeholder?: string;
  initialHtml?: string;
  mentions?: string[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Выпадашка @-упоминаний: список ников + позиция (координаты вьюпорта).
  const [menu, setMenu] = useState<{ items: string[]; x: number; y: number } | null>(null);

  function emit() {
    if (ref.current) onChange(serialize(ref.current).replace(/\n{3,}/g, "\n\n").trim());
  }
  useEffect(() => {
    if (initialHtml && ref.current) ref.current.innerHTML = initialHtml;
    emit();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function cmd(command: string, value?: string) {
    ref.current?.focus();
    document.execCommand(command, false, value);
    emit();
  }
  function addLink() {
    const url = prompt("Ссылка (https://…):")?.trim();
    if (!url) return;
    cmd("createLink", url);
  }
  // Обернуть выделение в элемент (надёжнее, чем execCommand formatBlock,
  // который на мобильных браузерах для "pre" часто не срабатывает).
  function wrapSelection(tagName: string, className?: string) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const el = document.createElement(tagName);
    if (className) el.className = className;
    try {
      el.appendChild(sel.getRangeAt(0).extractContents());
      sel.getRangeAt(0).insertNode(el);
      emit();
    } catch { /* noop */ }
  }
  function spoiler() { wrapSelection("span", "tg-spoiler"); }
  function code() { wrapSelection("code"); }

  // ---- Ссылки-слова и @-упоминания ----
  // Вставить кликабельное слово по ссылке в позицию курсора.
  function insertLink(url: string, text: string) {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      appendLink(url, text);
      return;
    }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const a = document.createElement("a");
    a.href = url; a.textContent = text;
    range.insertNode(a);
    const space = document.createTextNode(" ");
    a.after(space);
    const nr = document.createRange();
    nr.setStartAfter(space); nr.collapse(true);
    sel.removeAllRanges(); sel.addRange(nr);
    emit();
  }
  // Добавить кликабельное слово-ссылку в КОНЕЦ поста (с новой строки).
  function appendLink(url: string, text: string) {
    const el = ref.current;
    if (!el) return;
    if (el.textContent && el.textContent.trim()) el.appendChild(document.createElement("br"));
    const a = document.createElement("a");
    a.href = url; a.textContent = text;
    el.appendChild(a);
    emit();
  }
  function addPostLink() {
    const url = prompt("Вставьте ссылку на пост/ленту/канал в сервисе:")?.trim();
    if (!url) return;
    insertLink(url, labelForUrl(url));
  }
  function addEndLink() {
    const url = prompt("Ссылка (https://…):")?.trim();
    if (!url) return;
    appendLink(url, "Ссылка тут");
  }

  // Текущий вводимый @-токен перед курсором (для подсказок).
  function mentionToken(): { node: Text; start: number; end: number; query: string } | null {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return null;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE || !ref.current?.contains(node)) return null;
    const offset = sel.anchorOffset;
    const before = (node.textContent || "").slice(0, offset);
    const m = before.match(/@([a-zA-Z0-9_]{0,32})$/);
    if (!m) return null;
    return { node: node as Text, start: offset - m[0].length, end: offset, query: m[1].toLowerCase() };
  }
  function refreshMentions() {
    const tok = mentionToken();
    if (!tok || mentions.length === 0) { setMenu(null); return; }
    const items = (tok.query ? mentions.filter((u) => u.includes(tok.query)) : mentions).slice(0, 6);
    if (items.length === 0) { setMenu(null); return; }
    const sel = window.getSelection();
    let x = 12, y = 120;
    try {
      const r = sel!.getRangeAt(0).cloneRange();
      r.collapse(false);
      const rect = r.getClientRects()[0] || r.getBoundingClientRect();
      if (rect) { x = rect.left; y = rect.bottom + 4; }
    } catch { /* ignore */ }
    setMenu({ items, x, y });
  }
  function pickMention(username: string) {
    const tok = mentionToken();
    if (!tok) { setMenu(null); return; }
    const range = document.createRange();
    range.setStart(tok.node, tok.start);
    range.setEnd(tok.node, tok.end);
    range.deleteContents();
    const a = document.createElement("a");
    a.href = `${location.origin}/channel/${username}`;
    a.textContent = "@" + username;
    range.insertNode(a);
    const space = document.createTextNode(" ");
    a.after(space);
    const sel = window.getSelection();
    const nr = document.createRange();
    nr.setStartAfter(space); nr.collapse(true);
    sel?.removeAllRanges(); sel?.addRange(nr);
    setMenu(null);
    emit();
  }
  // Кнопка «@ канал» — ставит @ и открывает подсказки.
  function startMention() {
    ref.current?.focus();
    document.execCommand("insertText", false, "@");
    refreshMentions();
    emit();
  }

  function onPaste(e: React.ClipboardEvent) {
    const text = e.clipboardData?.getData("text/plain")?.trim();
    if (text && isServiceUrl(text)) {
      e.preventDefault();
      insertLink(text, labelForUrl(text));
    }
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (!menu) return;
    if (e.key === "Escape") { setMenu(null); }
    else if (e.key === "Enter" && menu.items.length) { e.preventDefault(); pickMention(menu.items[0]); }
  }

  return (
    <div className="rich">
      <div
        ref={ref}
        className="rich-area"
        contentEditable
        data-ph={placeholder || "Текст поста…"}
        onInput={() => { emit(); refreshMentions(); }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => setTimeout(() => setMenu(null), 200)}
        suppressContentEditableWarning
      />
      {menu && (
        <div className="mention-menu" style={{ position: "fixed", left: menu.x, top: menu.y, zIndex: 50 }}>
          {menu.items.map((u) => (
            <button key={u} type="button" className="mention-item"
              onMouseDown={(e) => { e.preventDefault(); pickMention(u); }}>
              @{u}
            </button>
          ))}
        </div>
      )}
      {/* Панель под полем — на телефоне её не перекрывает меню браузера. */}
      <div className="rich-toolbar">
        <button type="button" className="rich-btn" title="Жирный" onClick={() => cmd("bold")}><b>Ж</b></button>
        <button type="button" className="rich-btn" title="Курсив" onClick={() => cmd("italic")}><i>К</i></button>
        <button type="button" className="rich-btn" title="Подчёркнутый" onClick={() => cmd("underline")}><u>П</u></button>
        <button type="button" className="rich-btn" title="Зачёркнутый" onClick={() => cmd("strikeThrough")}><s>З</s></button>
        <button type="button" className="rich-btn" title="Код (моноширинный) — выделите текст" onClick={code}>{"</>"}</button>
        <button type="button" className="rich-btn" title="Цитата" onClick={() => cmd("formatBlock", "blockquote")}>❝</button>
        <button type="button" className="rich-btn" title="Спойлер" onClick={spoiler}>▓</button>
        <button type="button" className="rich-btn" title="Ссылка на выделенном тексте" onClick={addLink}>🔗</button>
        <button type="button" className="rich-btn" title="Упомянуть канал (@)" onMouseDown={(e) => { e.preventDefault(); startMention(); }}>@</button>
        <button type="button" className="rich-btn" title="Кликабельное слово по ссылке (пост/лента/канал)" onClick={addPostLink}>«пост»</button>
        <button type="button" className="rich-btn" title="Добавить «Ссылка тут» в конец поста" onClick={addEndLink}>Ссылка&nbsp;тут</button>
        <button type="button" className="rich-btn" title="Убрать формат" onClick={() => cmd("removeFormat")}>✕</button>
      </div>
    </div>
  );
}
