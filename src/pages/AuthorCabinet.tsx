import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TopBar, Loading } from "../components/States.tsx";
import RichEditor from "../components/RichEditor.tsx";
import VoiceRecorder from "../components/VoiceRecorder.tsx";
import PostPreview from "../components/PostPreview.tsx";
import {
  authorChannels, linkChannel, unlinkChannel, sendPostNow, schedulePost,
  scheduledPosts, cancelScheduled, updateScheduled, updateChannelInfo, uploadMedia, uploadAvatar,
  postedList, editPosted, deletePosted,
  type AuthorChannel, type PostMedia, type ScheduledPost, type PostedMessage,
} from "../lib/data.ts";

// ISO (UTC) → значение для input[type=datetime-local] в местном времени.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function AuthorCabinet() {
  const [channels, setChannels] = useState<AuthorChannel[] | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledPost[]>([]);
  const [posted, setPosted] = useState<PostedMessage[]>([]);
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
  const [editorKey, setEditorKey] = useState(0); // remount редактора для очистки/загрузки
  const [initialHtml, setInitialHtml] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  async function reload() {
    const chs = await authorChannels().catch((e) => { setMsg(e.message); return []; });
    setChannels(chs);
    if (chs.length && !chatId) setChatId(chs[0].chat_id);
    setScheduled(await scheduledPosts().catch(() => []));
    setPosted(await postedList().catch(() => []));
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
    setHtml(""); setMedia([]); setInitialHtml(""); setEditingId(null);
    setShowRec(false); setEditorKey((k) => k + 1);
  }
  // Загрузить запланированный пост в редактор.
  function startEdit(p: ScheduledPost) {
    setChatId(p.chat_id);
    setHtml(p.text || "");
    setInitialHtml(p.text || "");
    setMedia(p.media || []);
    setNoPreview(p.disable_preview);
    setWhen(toLocalInput(p.publish_at));
    setEditingId(p.id);
    setEditorKey((k) => k + 1);
    setMsg("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function doSaveEdit() {
    if (editingId == null || !when) { setMsg("Укажите дату и время"); return; }
    setSending(true); setMsg("");
    try {
      await updateScheduled(editingId, { ...payload(), publish_at: new Date(when).toISOString() });
      resetComposer(); setWhen(""); setMsg("Изменения сохранены ✓");
      setScheduled(await scheduledPosts().catch(() => []));
    } catch (e) { setMsg("Ошибка: " + (e as Error).message); }
    finally { setSending(false); }
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
      setPosted(await postedList().catch(() => []));
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
        {msg && <div className="card msg-card" style={{ fontSize: 13 }}>{msg}</div>}

        {!channels && <Loading />}

        {/* Онбординг — только пока нет ни одного канала */}
        {channels && channels.length === 0 && (
          <>
            <div className="card" style={{ fontSize: 14 }}>
              <h3 style={{ marginTop: 0 }}>Публикуйте в свои каналы без VPN</h3>
              Добавьте бота <b>@tgparsertgfeed_bot</b> администратором канала (с правом
              «Публикация сообщений»), затем привяжите канал. Публиковать можно только в
              каналы, где вы сами админ.
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Привязать канал</h3>
              <div className="field">
                <input type="text" placeholder="@username канала" value={linkInput} onChange={(e) => setLinkInput(e.target.value)} />
              </div>
              <button className="btn" onClick={doLink} disabled={busy}>{busy ? "Проверяю…" : "Проверить и привязать"}</button>
            </div>
          </>
        )}

        {/* Композер */}
        {channels && channels.length > 0 && (
          <div className="card">
            <div className="row spread">
              <h3 style={{ marginTop: 0 }}>{editingId ? "Редактирование поста" : "Новый пост"}</h3>
              {editingId && <button className="btn ghost sm" onClick={resetComposer}>Отменить</button>}
            </div>
            <div className="field">
              <label>Канал</label>
              <select className="folder-select" style={{ width: "100%" }} value={chatId} onChange={(e) => setChatId(e.target.value)}>
                {channels.map((c) => <option key={c.id} value={c.chat_id}>{c.title || c.chat_id}</option>)}
              </select>
            </div>
            <RichEditor key={editorKey} initialHtml={initialHtml} onChange={setHtml} placeholder="Текст поста — выделите текст и нажмите Ж/К/…" />

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

            {editingId ? (
              <div className="field" style={{ marginTop: 10 }}>
                <label>Дата и время публикации</label>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ width: "auto", flex: 1 }} />
                  <button className="btn" onClick={doSaveEdit} disabled={sending || empty || !when}>{sending ? "…" : "Сохранить"}</button>
                </div>
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>
        )}

        {/* Запланированные — свёрнуто, с превью «как в ленте» */}
        {scheduled.length > 0 && (
          <details className="card fold">
            <summary>Запланировано ({scheduled.length})</summary>
            <div style={{ marginTop: 10, display: "grid", gap: 14 }}>
              {scheduled.map((p) => {
                const ch = channels?.find((c) => c.chat_id === p.chat_id);
                return (
                  <div key={p.id}>
                    <div className="row spread" style={{ marginBottom: 6 }}>
                      <span className="muted" style={{ fontSize: 12 }}>
                        🕒 {new Date(p.publish_at).toLocaleString("ru-RU")}
                        {p.status === "failed" && " · ошибка"}
                      </span>
                      <div className="row" style={{ gap: 6, flex: "0 0 auto" }}>
                        <button className="btn ghost sm" onClick={() => startEdit(p)}>Изменить</button>
                        <button className="btn ghost sm" onClick={async () => { if (confirm("Удалить пост?")) { await cancelScheduled(p.id); setScheduled(await scheduledPosts().catch(() => [])); } }}>Удалить</button>
                      </div>
                    </div>
                    <PostPreview channelName={ch?.title || p.chat_id} html={p.text || ""} media={p.media || []} />
                    {p.error && <div className="muted" style={{ fontSize: 12, color: "var(--pink)", marginTop: 4 }}>Ошибка: {p.error}</div>}
                  </div>
                );
              })}
            </div>
          </details>
        )}

        {/* Опубликованные — правка текста / удаление прямо в канале */}
        {posted.length > 0 && (
          <details className="card fold">
            <summary>Опубликованные ({posted.length})</summary>
            <div className="muted" style={{ fontSize: 12, margin: "6px 0" }}>Правка текста и удаление применяются прямо в Telegram-канале.</div>
            {posted.map((p) => {
              const ch = channels?.find((c) => c.chat_id === p.chat_id);
              return <PostedItem key={p.id} post={p} channelName={ch?.title || p.chat_id} onChanged={async () => setPosted(await postedList().catch(() => []))} onMsg={setMsg} />;
            })}
          </details>
        )}

        {/* Мои каналы */}
        {channels && channels.length > 0 && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Мои каналы</h3>
            <div className="chan-list">
              {channels.map((c) => (
                <div key={c.id} className="chan-item">
                  <div className="chan-item-main">
                    <div className="chan-item-title">{c.title || c.chat_id}</div>
                    {c.username && (
                      <Link className="chan-item-link" to={`/channel/${c.username}`}>@{c.username} · страница в сервисе ↗</Link>
                    )}
                    <div className="row" style={{ gap: 6, marginTop: 8 }}>
                      <button className="btn ghost sm" onClick={() => setSettingsFor(settingsFor === c.id ? null : c.id)}>⚙ Настройки</button>
                      <button className="btn ghost sm" onClick={async () => { if (confirm("Отвязать канал?")) { await unlinkChannel(c.id); reload(); } }}>Отвязать</button>
                    </div>
                    {settingsFor === c.id && <ChannelSettings channel={c} onDone={() => setMsg("Изменения канала применены (если у бота есть права).")} />}
                  </div>
                </div>
              ))}
            </div>
            <details className="fold" style={{ marginTop: 12, border: "none", background: "none" }}>
              <summary style={{ padding: "6px 0" }}>+ Привязать ещё канал</summary>
              <div className="field" style={{ marginTop: 6 }}>
                <input type="text" placeholder="@username канала" value={linkInput} onChange={(e) => setLinkInput(e.target.value)} />
              </div>
              <button className="btn sm" onClick={doLink} disabled={busy}>{busy ? "Проверяю…" : "Проверить и привязать"}</button>
            </details>
          </div>
        )}
      </div>
    </>
  );
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

// Опубликованный пост: правка текста (editMessage*) и удаление (deleteMessage).
function PostedItem({ post, channelName, onChanged, onMsg }: { post: PostedMessage; channelName: string; onChanged: () => void; onMsg: (s: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [html, setHtml] = useState(post.text || "");
  const [busy, setBusy] = useState(false);
  const canEditText = post.text_message_id != null;

  async function save() {
    setBusy(true);
    try { await editPosted(post.id, html); setEditing(false); onMsg("Текст обновлён ✓"); onChanged(); }
    catch (e) { onMsg("Ошибка: " + (e as Error).message); }
    finally { setBusy(false); }
  }
  async function del() {
    if (!confirm("Удалить пост из канала?")) return;
    setBusy(true);
    try {
      const r = await deletePosted(post.id);
      onMsg(r.warning ? "Убрано из списка. Telegram: " + r.warning : "Удалено из канала ✓");
      onChanged();
    } catch (e) { onMsg("Ошибка: " + (e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ borderTop: "1px solid var(--surface-2)", paddingTop: 8, marginTop: 8 }}>
      <div className="row spread">
        <div style={{ minWidth: 0 }}>
          <div className="muted" style={{ fontSize: 12 }}>{channelName} · {new Date(post.sent_at).toLocaleString("ru-RU")}</div>
          {!editing && (
            <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 }}>
              {(post.text || "").replace(/<[^>]+>/g, "") || "[медиа]"}
            </div>
          )}
        </div>
        {!editing && (
          <div className="row" style={{ gap: 6, flex: "0 0 auto" }}>
            {canEditText && <button className="btn ghost sm" onClick={() => setEditing(true)} disabled={busy}>Изменить текст</button>}
            <button className="btn ghost sm" onClick={del} disabled={busy}>Удалить</button>
          </div>
        )}
      </div>
      {editing && (
        <div style={{ marginTop: 8 }}>
          <RichEditor initialHtml={post.text || ""} onChange={setHtml} />
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn sm" onClick={save} disabled={busy}>{busy ? "…" : "Сохранить"}</button>
            <button className="btn ghost sm" onClick={() => setEditing(false)}>Отмена</button>
          </div>
        </div>
      )}
    </div>
  );
}
