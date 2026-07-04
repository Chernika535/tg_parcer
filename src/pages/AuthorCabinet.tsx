import { useEffect, useRef, useState } from "react";
import { TopBar, Loading } from "../components/States.tsx";
import {
  authorChannels, linkChannel, unlinkChannel, sendPostNow, schedulePost,
  scheduledPosts, cancelScheduled, updateChannelInfo, uploadMedia, uploadAvatar,
  type AuthorChannel, type PostMedia, type ScheduledPost,
} from "../lib/data.ts";

export default function AuthorCabinet() {
  const [channels, setChannels] = useState<AuthorChannel[] | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledPost[]>([]);
  const [linkInput, setLinkInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [settingsFor, setSettingsFor] = useState<number | null>(null);

  // Композер
  const [chatId, setChatId] = useState("");
  const [text, setText] = useState("");
  const [media, setMedia] = useState<PostMedia[]>([]);
  const [noPreview, setNoPreview] = useState(false);
  const [when, setWhen] = useState("");
  const [sending, setSending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  async function reload() {
    const chs = await authorChannels().catch((e) => { setMsg(e.message); return []; });
    setChannels(chs);
    if (chs.length && !chatId) setChatId(chs[0].chat_id);
    setScheduled(await scheduledPosts().catch(() => []));
  }
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function doLink() {
    if (!linkInput.trim()) return;
    setBusy(true); setMsg("");
    try {
      await linkChannel(linkInput.trim());
      setLinkInput("");
      setMsg("Канал привязан ✓");
      await reload();
    } catch (e) { setMsg("Ошибка: " + (e as Error).message); }
    finally { setBusy(false); }
  }

  // Форматирование: оборачиваем выделение в HTML-тег (parse_mode=HTML).
  function wrap(tag: string, attr = "") {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = text.slice(s, e) || "текст";
    const open = attr ? `<${tag} ${attr}>` : `<${tag}>`;
    const next = text.slice(0, s) + open + sel + `</${tag}>` + text.slice(e);
    setText(next);
    setTimeout(() => { ta.focus(); ta.selectionStart = s + open.length; ta.selectionEnd = s + open.length + sel.length; }, 0);
  }
  function addLink() {
    const url = prompt("Ссылка (https://…):")?.trim();
    if (!url) return;
    wrap("a", `href="${url.replace(/"/g, "&quot;")}"`);
  }

  async function addFile(type: "photo" | "video", file: File) {
    setBusy(true); setMsg("");
    try {
      const url = await uploadMedia(file);
      setMedia((m) => [...m, { type, url }]);
    } catch (e) { setMsg("Загрузка не удалась: " + (e as Error).message); }
    finally { setBusy(false); }
  }

  // Запись голосового прямо в браузере.
  const recRef = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  async function toggleRec() {
    if (recording) { recRef.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus") ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      mr.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setBusy(true);
        try {
          const blob = new Blob(chunks, { type: mime || "audio/ogg" });
          const url = await uploadMedia(blob, "ogg");
          setMedia((m) => [...m, { type: "voice", url }]);
        } catch (e) { setMsg("Голосовое не загрузилось: " + (e as Error).message); }
        finally { setBusy(false); }
      };
      recRef.current = mr; mr.start(); setRecording(true);
    } catch (e) { setMsg("Нет доступа к микрофону: " + (e as Error).message); }
  }

  function payload() {
    return { chat_id: chatId, text: text.trim() || undefined, parse_mode: "HTML" as const, media, disable_preview: noPreview };
  }
  async function doSend() {
    if (!chatId) return;
    setSending(true); setMsg("");
    try {
      await sendPostNow(payload());
      setText(""); setMedia([]); setMsg("Опубликовано ✓");
    } catch (e) { setMsg("Ошибка: " + (e as Error).message); }
    finally { setSending(false); }
  }
  async function doSchedule() {
    if (!chatId || !when) { setMsg("Укажите дату и время"); return; }
    setSending(true); setMsg("");
    try {
      await schedulePost({ ...payload(), publish_at: new Date(when).toISOString() });
      setText(""); setMedia([]); setWhen(""); setMsg("Запланировано ✓");
      setScheduled(await scheduledPosts().catch(() => []));
    } catch (e) { setMsg("Ошибка: " + (e as Error).message); }
    finally { setSending(false); }
  }

  const empty = !text.trim() && media.length === 0;

  return (
    <>
      <TopBar title="Кабинет автора" />
      <div className="content">
        <div className="card" style={{ fontSize: 13 }}>
          Постинг в ваши каналы через нашего бота — <b>без VPN</b>. Добавьте бота
          <b> @tgparsertgfeed_bot</b> администратором канала (с правом «Публикация сообщений»),
          затем привяжите канал ниже. Публиковать сможете только в каналы, где вы сами админ.
        </div>

        {/* Привязка канала */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Привязать канал</h3>
          <div className="field">
            <input type="text" placeholder="@username канала" value={linkInput} onChange={(e) => setLinkInput(e.target.value)} />
          </div>
          <button className="btn" onClick={doLink} disabled={busy}>{busy ? "Проверяю…" : "Проверить и привязать"}</button>
        </div>

        {/* Мои каналы */}
        {!channels && <Loading />}
        {channels && channels.length > 0 && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Мои каналы</h3>
            {channels.map((c) => (
              <div key={c.id} style={{ borderTop: "1px solid var(--surface-2)", paddingTop: 8, marginTop: 8 }}>
                <div className="row spread">
                  <div>
                    <div style={{ fontWeight: 700 }}>{c.title || c.chat_id}</div>
                    {c.username && <div className="muted" style={{ fontSize: 12 }}>@{c.username}</div>}
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn ghost sm" onClick={() => setSettingsFor(settingsFor === c.id ? null : c.id)}>⚙ Настройки</button>
                    <button className="btn ghost sm" onClick={async () => { if (confirm("Отвязать канал?")) { await unlinkChannel(c.id); reload(); } }}>Отвязать</button>
                  </div>
                </div>
                {settingsFor === c.id && <ChannelSettings channel={c} onDone={() => setMsg("Изменения канала применены (если у бота есть права).")} />}
              </div>
            ))}
          </div>
        )}
        {channels && channels.length === 0 && (
          <div className="card muted">Пока нет привязанных каналов. Добавьте бота админом и привяжите канал выше.</div>
        )}

        {/* Композер */}
        {channels && channels.length > 0 && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Новый пост</h3>
            <div className="field">
              <label>Канал</label>
              <select className="folder-select" style={{ width: "100%" }} value={chatId} onChange={(e) => setChatId(e.target.value)}>
                {channels.map((c) => <option key={c.id} value={c.chat_id}>{c.title || c.chat_id}</option>)}
              </select>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
              <button className="btn ghost sm" onClick={() => wrap("b")}><b>Ж</b></button>
              <button className="btn ghost sm" onClick={() => wrap("i")}><i>К</i></button>
              <button className="btn ghost sm" onClick={() => wrap("u")}><u>П</u></button>
              <button className="btn ghost sm" onClick={() => wrap("s")}><s>З</s></button>
              <button className="btn ghost sm" onClick={() => wrap("code")}>{"</>"}</button>
              <button className="btn ghost sm" onClick={addLink}>🔗 ссылка</button>
            </div>
            <textarea ref={taRef} rows={6} placeholder="Текст поста (поддерживается форматирование)" value={text} onChange={(e) => setText(e.target.value)} />

            <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <label className="btn secondary sm" style={{ cursor: "pointer" }}>
                🖼 Фото<input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && addFile("photo", e.target.files[0])} />
              </label>
              <label className="btn secondary sm" style={{ cursor: "pointer" }}>
                🎬 Видео<input type="file" accept="video/*" hidden onChange={(e) => e.target.files?.[0] && addFile("video", e.target.files[0])} />
              </label>
              <button className={`btn sm ${recording ? "danger" : "secondary"}`} onClick={toggleRec}>
                {recording ? "⏹ Остановить запись" : "🎤 Записать голосовое"}
              </button>
            </div>

            {media.length > 0 && (
              <div className="tags" style={{ marginTop: 8 }}>
                {media.map((m, i) => (
                  <span key={i} className="tag">
                    {m.type === "photo" ? "🖼 фото" : m.type === "video" ? "🎬 видео" : "🎤 голос"}
                    <button className="chip-x" onClick={() => setMedia((arr) => arr.filter((_, j) => j !== i))}>✕</button>
                  </span>
                ))}
              </div>
            )}

            <label className="row" style={{ gap: 8, marginTop: 8, fontSize: 14 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={noPreview} onChange={(e) => setNoPreview(e.target.checked)} />
              Не показывать превью ссылок
            </label>

            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button className="btn" onClick={doSend} disabled={sending || empty}>{sending ? "…" : "Опубликовать сейчас"}</button>
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label>Отложенная публикация</label>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ width: "auto", flex: 1 }} />
                <button className="btn secondary" onClick={doSchedule} disabled={sending || empty || !when}>Запланировать</button>
              </div>
            </div>
          </div>
        )}

        {/* Запланированные */}
        {scheduled.length > 0 && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Запланировано</h3>
            {scheduled.map((p) => {
              const ch = channels?.find((c) => c.chat_id === p.chat_id);
              return (
                <div key={p.id} style={{ borderTop: "1px solid var(--surface-2)", paddingTop: 8, marginTop: 8 }}>
                  <div className="row spread">
                    <div style={{ minWidth: 0 }}>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {ch?.title || p.chat_id} · {new Date(p.publish_at).toLocaleString("ru-RU")}
                        {p.status !== "pending" && ` · ${statusLabel(p.status)}`}
                      </div>
                      <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 }}>
                        {(p.text || "").replace(/<[^>]+>/g, "") || (p.media.length ? "[медиа]" : "—")}
                      </div>
                      {p.error && <div className="muted" style={{ fontSize: 12, color: "var(--pink)" }}>Ошибка: {p.error}</div>}
                    </div>
                    <button className="btn ghost sm" onClick={async () => { await cancelScheduled(p.id); setScheduled(await scheduledPosts().catch(() => [])); }}>Удалить</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {msg && <div className="card" style={{ fontSize: 13 }}>{msg}</div>}
      </div>
    </>
  );
}

function statusLabel(s: string): string {
  return s === "sent" ? "отправлено" : s === "failed" ? "ошибка" : s === "canceled" ? "отменено" : s;
}

function ChannelSettings({ channel, onDone }: { channel: AuthorChannel; onDone: () => void }) {
  const [title, setTitle] = useState(channel.title || "");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function save(photoUrl?: string) {
    setSaving(true); setErr("");
    try {
      await updateChannelInfo({ chat_id: channel.chat_id, title: title.trim() || undefined, description: description.trim() || undefined, photo_url: photoUrl });
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  }
  async function pickPhoto(file: File) {
    setSaving(true); setErr("");
    try {
      const url = await uploadAvatar(file);
      await updateChannelInfo({ chat_id: channel.chat_id, photo_url: url });
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ marginTop: 8, paddingLeft: 4 }}>
      <div className="field"><label>Название канала</label><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="field"><label>Описание канала</label><textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Новое описание" /></div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn sm" onClick={() => save()} disabled={saving}>{saving ? "…" : "Сохранить название/описание"}</button>
        <label className="btn secondary sm" style={{ cursor: "pointer" }}>Сменить аватар<input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && pickPhoto(e.target.files[0])} /></label>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Для смены нужно право бота «Изменение профиля канала».</div>
      {err && <div className="muted" style={{ fontSize: 12, color: "var(--pink)", marginTop: 4 }}>{err}</div>}
    </div>
  );
}
