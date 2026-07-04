import { useEffect, useRef } from "react";

// Визуальный редактор поста: показывает форматирование как в Telegram и отдаёт
// готовый HTML (parse_mode=HTML). Внутри — contentEditable + execCommand.
const ALLOWED: Record<string, string> = {
  B: "b", STRONG: "b", I: "i", EM: "i", U: "u",
  S: "s", STRIKE: "s", DEL: "s", CODE: "code", PRE: "pre", A: "a",
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
      } else if (tag) {
        out += `<${tag}>${inner}</${tag}>`;
      } else {
        out += (isBlock && out && !out.endsWith("\n") ? "\n" : "") + inner;
      }
    }
  });
  return out;
}

export default function RichEditor({ onChange, placeholder, initialHtml }: { onChange: (html: string) => void; placeholder?: string; initialHtml?: string }) {
  const ref = useRef<HTMLDivElement>(null);

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
  function spoiler() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const span = document.createElement("span");
    span.className = "tg-spoiler";
    try { span.appendChild(sel.getRangeAt(0).extractContents()); sel.getRangeAt(0).insertNode(span); emit(); } catch { /* noop */ }
  }

  return (
    <div className="rich">
      <div
        ref={ref}
        className="rich-area"
        contentEditable
        data-ph={placeholder || "Текст поста…"}
        onInput={emit}
        suppressContentEditableWarning
      />
      {/* Панель под полем — на телефоне её не перекрывает меню браузера. */}
      <div className="rich-toolbar">
        <button type="button" className="rich-btn" title="Жирный" onClick={() => cmd("bold")}><b>Ж</b></button>
        <button type="button" className="rich-btn" title="Курсив" onClick={() => cmd("italic")}><i>К</i></button>
        <button type="button" className="rich-btn" title="Подчёркнутый" onClick={() => cmd("underline")}><u>П</u></button>
        <button type="button" className="rich-btn" title="Зачёркнутый" onClick={() => cmd("strikeThrough")}><s>З</s></button>
        <button type="button" className="rich-btn" title="Моноширинный" onClick={() => cmd("formatBlock", "pre")}>{"</>"}</button>
        <button type="button" className="rich-btn" title="Спойлер" onClick={spoiler}>▓</button>
        <button type="button" className="rich-btn" title="Ссылка" onClick={addLink}>🔗</button>
        <button type="button" className="rich-btn" title="Убрать формат" onClick={() => cmd("removeFormat")}>✕</button>
      </div>
    </div>
  );
}
