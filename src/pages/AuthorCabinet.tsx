import { useEffect, useState } from "react";
import { TopBar, Loading } from "../components/States.tsx";
import RichEditor from "../components/RichEditor.tsx";
import VoiceRecorder from "../components/VoiceRecorder.tsx";
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
  const [html, setHtml] = useState("");
  const [media, setMedia] = useState<PostMedia[]>([]);
  const [noPreview, setNoPreview] = useState(false);
  const [when, setWhen] = useState("");
  const [sending, setSending] = useState(false);
  const [showRec, setShowRec] = useState(false);
  const [editorKey, setEditorKey] = useState(0); // remount редактора для очистки

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

  // Прикрепление файлов (можно несколько). Фото/видео — максимум 10 на пост.
  async function addFiles(type: PostMedia["type"], files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true); setMsg("");
    const isVisual = type === "photo" || type === "video";
    let room = 10 - media.filter((m) => m.type === "photo" || m.type === "video").length;
    try {
      for (const file of Array.from(files)) {
        if (isVisual && room <= 0) { setMsg("В одном посте максимум 10 фото/видео"); break; }
        const url = await uploadMedia(file);
        const base = file.name.replace(/\.[^.]+$/, "");
        const extra = type === "audio" ? { title: base } : type === "document" ? { name: file.name } : {};
        setMedia((m) => [...m, { type, url, ...extra }]);
        if (isVisual) room--;
      }
    } catch (e) { setMsg("Загрузка не удалась: " + (e as Error).message); }
    finally { setBusy(false); }
  }

  async function onVoice(blob: Blob) {
    setShowRec(false); setBusy(true); setMsg("");
    try {
      const url = await uploadMedia(blob, "ogg");
      setMedia((m) => [...m, { type: "voice", url }]);
    } catch (e) { setMsg("Голосовое не загрузилось: " + (e as Error).message); }
    finally { setBusy(false); }
  }

  function resetComposer() {
    setHtml(""); setMedia([]); setEditorKey((k) => k + 1);
  }
  function payload() {
    return { chat_id: chatId, text: html.trim() || undefined, parse_mode: "HTML" as const, media, disable_preview: noPreview };
  }
  async function doSend() {
    if (!chatId) return;
    setSending(true); setMsg("");
    try {
      await sendPostNow(payload());
      resetComposer(); setMsg("Опубликовано ✓");
    } catch (e) { setMsg("Ошибка: " + (e as Error).message); }
    finally { setSending(false); }
  }
  async function doSchedule() {
    if (!chatId || !when) { setMsg("Укажите дату и время"); return; }
    setSending(true); setMsg("");
    try {
      await schedulePost({ ...payload(), publish_at: new Date(when).toISOString() });
      resetComposer(); setWhen(""); setMsg("Запланировано ✓");
      setScheduled(await scheduledPosts().catch(() => []));
    } catch (e) { setMsg("Ошибка: " + (e as Error).message); }
    finally { setSending(false); }
  }

  const empty = !html.trim() && media.length === 0;
  const mediaLabel = (m: PostMedia) =>
    m.type === "photo" ? "🖼 фото" : m.type === "video" ? "🎬 видео" : m.type === "voice" ? "🎤 голос"
    : m.type === "audio" ? `🎵 ${m.title || "музыка"}` : `📎 ${m.name || "файл"}`;

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
            <RichEditor key={editorKey} onChange={setHtml} placeholder="Текст поста — выделите текст и нажмите Ж/К/…" />

            <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <label className="btn secondary sm" style={{ cursor: "pointer" }}>
                🖼 Фото<input type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles("photo", e.target.files); e.target.value = ""; }} />
              </label>
              <label className="btn secondary sm" style={{ cursor: "pointer" }}>
                🎬 Видео<input type="file" accept="video/*" multiple hidden onChange={(e) => { addFiles("video", e.target.files); e.target.value = ""; }} />
              </label>
              <label className="btn secondary sm" style={{ cursor: "pointer" }}>
                🎵 Музыка<input type="file" accept="audio/*" multiple hidden onChange={(e) => { addFiles("audio", e.target.files); e.target.value = ""; }} />
              </label>
              <label className="btn secondary sm" style={{ cursor: "pointer" }}>
                📎 Файл<input type="file" multiple hidden onChange={(e) => { addFiles("document", e.target.files); e.target.value = ""; }} />
              </label>
              {!showRec && <button className="btn secondary sm" onClick={() => setShowRec(true)}>🎤 Голосовое</button>}
            </div>

            {showRec && <div style={{ marginTop: 8 }}><VoiceRecorder onDone={onVoice} onCancel={() => setShowRec(false)} /></div>}

            {media.length > 0 && (
              <div className="media-previews">
                {media.map((m, i) => {
                  const rm = () => setMedia((arr) => arr.filter((_, j) => j !== i));
                  if (m.type === "photo" || m.type === "video") {
                    return (
                      <div key={i} className="mp-thumb">
                        {m.type === "photo"
                          ? <img src={m.url} alt="" />
                          : <video src={m.url} muted playsInline preload="metadata" />}
                        {m.type === "video" && <span className="mp-badge">▶</span>}
                        <button className="mp-x" onClick={rm} aria-label="Убрать">✕</button>
                      </div>
                    );
                  }
                  return (
                    <span key={i} className="tag">{mediaLabel(m)}<button className="chip-x" onClick={rm}>✕</button></span>
                  );
                })}
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
