import { useRef, useState } from "react";
import { uploadMedia, importArchive, type AuthorChannel } from "../lib/data.ts";

// Импорт истории канала из экспорта Telegram Desktop (формат JSON).
// Браузер автора читает result.json, заливает медиа в наш Storage и шлёт
// метаданные постов пачками на сервер. Тяжёлую работу делает браузер — сервер
// и его лимиты не задеваем.

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// text из экспорта: строка или массив частей {type,text,href}. → безопасный HTML.
// deno-lint-ignore no-explicit-any
function partsToHtml(text: any): string {
  if (typeof text === "string") return esc(text);
  if (!Array.isArray(text)) return "";
  return text.map((p) => {
    if (typeof p === "string") return esc(p);
    const t = esc(p.text ?? "");
    switch (p.type) {
      case "bold": return `<b>${t}</b>`;
      case "italic": return `<i>${t}</i>`;
      case "underline": return `<u>${t}</u>`;
      case "strikethrough": return `<s>${t}</s>`;
      case "spoiler": return `<span class="tg-spoiler">${t}</span>`;
      case "code": case "pre": return `<code>${t}</code>`;
      case "blockquote": return `<blockquote>${t}</blockquote>`;
      case "text_link": return `<a href="${esc(p.href || "")}" target="_blank" rel="noreferrer">${t}</a>`;
      default: return t; // link/mention/hashtag/email — оставляем текстом
    }
  }).join("");
}

const IMG_EXT = /\.(jpg|jpeg|png|webp|gif)$/i;

export default function ArchiveImport({ channels }: { channels: AuthorChannel[] }) {
  const [chatId, setChatId] = useState(channels[0]?.chat_id ?? "");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length || !chatId) return;
    setBusy(true); setMsg(""); setProgress(null);
    try {
      // Карта файлов по пути относительно корня экспорта (первый сегмент — папка).
      const map = new Map<string, File>();
      let resultFile: File | null = null;
      for (const f of files) {
        const rel = f.webkitRelativePath.split("/").slice(1).join("/");
        map.set(rel, f);
        if (rel === "result.json") resultFile = f;
      }
      if (!resultFile) throw new Error("В папке нет result.json — экспортируйте историю в формате JSON.");

      const json = JSON.parse(await resultFile.text());
      // deno-lint-ignore no-explicit-any
      const messages: any[] = json.messages ?? [];
      const real = messages.filter((m) => m.type === "message");
      setProgress({ done: 0, total: real.length });

      // deno-lint-ignore no-explicit-any
      const uploadRef = async (rel?: string): Promise<string | undefined> => {
        if (!rel) return undefined;
        const file = map.get(rel);
        if (!file) return undefined;
        const ext = (rel.split(".").pop() || "bin").toLowerCase();
        try { return await uploadMedia(file, ext); } catch { return undefined; }
      };

      let batch: Record<string, unknown>[] = [];
      let done = 0;
      const flush = async () => {
        if (!batch.length) return;
        await importArchive(chatId, batch);
        batch = [];
      };

      for (const m of real) {
        const media: Record<string, unknown>[] = [];
        // Фото
        if (m.photo) {
          const url = await uploadRef(m.photo);
          if (url) media.push({ type: "photo", url });
        }
        // Файлы (видео/аудио/голос/кружок/стикер/документ)
        if (m.file && m.media_type) {
          const url = await uploadRef(m.file);
          const thumb = await uploadRef(m.thumbnail);
          if (m.media_type === "video_file" || m.media_type === "animation") media.push({ type: "video", url, thumb });
          else if (m.media_type === "video_message") media.push({ type: "roundvideo", url, thumb });
          else if (m.media_type === "voice_message") media.push({ type: "voice", url });
          else if (m.media_type === "audio_file") media.push({ type: "audio", url, title: m.title, performer: m.performer });
          else if (m.media_type === "sticker") { if (url && IMG_EXT.test(m.file)) media.push({ type: "sticker", url }); }
          else media.push({ type: "document", title: m.file_name || "файл", url });
        }
        const text = partsToHtml(m.text).trim();
        if (text || media.length) {
          batch.push({
            msgId: m.id,
            postedAt: new Date(Number(m.date_unixtime || 0) * 1000 || m.date).toISOString(),
            text: text || null,
            media,
          });
        }
        done++;
        if (done % 10 === 0) setProgress({ done, total: real.length });
        if (batch.length >= 40) await flush();
      }
      await flush();
      setProgress({ done: real.length, total: real.length });
      setMsg(`Импортировано постов: ${real.length}. Откройте страницу канала — история на месте.`);
    } catch (e) {
      setMsg("Ошибка импорта: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Импорт истории канала</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Сохраните все прошлые посты у нас — они останутся на странице канала, даже если Telegram недоступен.
      </p>
      <ol className="bot-steps">
        <li>В Telegram Desktop: канал → ⋮ → «Экспорт истории чата» → формат <b>JSON</b> (с медиа).</li>
        <li>Выберите ниже канал и укажите <b>папку</b> экспорта — браузер сам всё загрузит.</li>
      </ol>
      <div className="field">
        <label>Канал</label>
        <select className="folder-select" style={{ width: "100%" }} value={chatId} onChange={(e) => setChatId(e.target.value)}>
          {channels.map((c) => <option key={c.id} value={c.chat_id}>{c.title || c.chat_id}</option>)}
        </select>
      </div>
      <label className="btn secondary sm" style={{ cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
        {busy ? "Импортирую…" : "Выбрать папку экспорта"}
        {/* webkitdirectory — выбор целой папки */}
        <input
          ref={inputRef}
          type="file"
          hidden
          disabled={busy}
          onChange={onPick}
          // @ts-expect-error нестандартные атрибуты выбора папки
          webkitdirectory=""
          directory=""
        />
      </label>
      {progress && (
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          Обработано: {progress.done} / {progress.total}
        </div>
      )}
      {msg && <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>{msg}</div>}
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Медиа больших каналов — это гигабайты в нашем хранилище: начните с одного канала и следите за объёмом.
      </p>
    </div>
  );
}
