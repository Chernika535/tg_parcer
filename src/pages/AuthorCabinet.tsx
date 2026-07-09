import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TopBar, Loading } from "../components/States.tsx";
import RichEditor from "../components/RichEditor.tsx";
import VoiceRecorder from "../components/VoiceRecorder.tsx";
import CircleRecorder from "../components/CircleRecorder.tsx";
import PostPreview from "../components/PostPreview.tsx";
import MediaFilterPicker from "../components/MediaFilterPicker.tsx";
import { appConfig } from "../lib/supabase.ts";
import { useAuth } from "../lib/auth.tsx";

// Инструкция «как привязать канал» с ником нашего бота и кнопкой-диплинком,
// которая сразу открывает Telegram для добавления бота админом в канал.
function BotLinkHelp() {
  const bot = appConfig().botUsername;
  const { profile } = useAuth();
  const rights = "post_messages+edit_messages+delete_messages+pin_messages+change_info";
  const addLink = `https://t.me/${bot}?startchannel&admin=${rights}`;
  return (
    <div className="bot-help">
      {!profile?.telegram_id && (
        <div className="bot-warn">
          ⚠️ Вы зарегистрированы по e-mail. Сначала привяжите Telegram-аккаунт, который
          админ этих каналов — это в разделе <Link to="/account" style={{ textDecoration: "underline" }}>Аккаунт</Link>.
          Иначе мы не сможем подтвердить, что канал ваш.
        </div>
      )}
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Как привязать канал</div>
      <ol className="bot-steps">
        <li>Нажмите «Добавить бота в канал» — Telegram предложит выбрать ваш канал и добавит бота <b>@{bot}</b> админом с нужными правами.</li>
        <li>Если добавляете вручную: канал → «Администраторы» → добавьте <b>@{bot}</b> с правом «Публикация сообщений».</li>
        <li>Вернитесь сюда и введите @username канала.</li>
      </ol>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <a className="btn sm" href={addLink} target="_blank" rel="noreferrer">Добавить бота в канал ↗</a>
        <button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText("@" + bot); }}>Скопировать @{bot}</button>
      </div>
    </div>
  );
}
import {
  authorChannels, linkChannel, unlinkChannel, refreshChannel, sendPostNow, schedulePost,
  scheduledPosts, cancelScheduled, updateScheduled, updateChannelInfo, uploadMedia, uploadAvatar,
  postedList, editPosted, deletePosted, serviceChannels,
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
  const [showCirc, setShowCirc] = useState(false);
  const [editorKey, setEditorKey] = useState(0); // remount редактора для очистки/загрузки
  const [initialHtml, setInitialHtml] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [filterChan, setFilterChan] = useState("all"); // фильтр отложки/опубликованных по каналу
  const [filterFor, setFilterFor] = useState<number | null>(null); // индекс медиа для выбора фильтра
  const [mentionList, setMentionList] = useState<string[]>([]); // ники каналов для @-подсказок
  const [showAllPosted, setShowAllPosted] = useState(false); // раскрыть посты старше недели
  const [retryFn, setRetryFn] = useState<{ run: () => void } | null>(null); // повтор после ошибки

  async function reload() {
    const chs = await authorChannels().catch((e) => { setMsg(e.message); return []; });
    setChannels(chs);
    if (chs.length && !chatId) setChatId(chs[0].chat_id);
    setScheduled(await scheduledPosts().catch(() => []));
    setPosted(await postedList().catch(() => []));
  }
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Ники каналов для @-подсказок: свои каналы + все каналы из публичных лент.
  useEffect(() => {
    serviceChannels().then((svc) => {
      const own = (channels ?? []).map((c) => (c.username || "").toLowerCase()).filter(Boolean);
      setMentionList([...new Set([...own, ...svc])]);
    }).catch(() => {});
  }, [channels]);

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

  async function onCircle(blob: Blob) {
    setShowCirc(false); setBusy(true); setMsg("");
    try {
      const url = await uploadMedia(blob, "mp4");
      setMedia((m) => [...m, { type: "videonote", url }]);
    } catch (e) { setMsg("Кружок не загрузился: " + (e as Error).message); }
    finally { setBusy(false); }
  }

  // Применить стилевой фильтр к фото/видео: запечённый файл заливаем заново.
  async function onFiltered(blob: Blob, idx: number) {
    setFilterFor(null); setBusy(true); setMsg("");
    try {
      const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("mp4") ? "mp4" : "jpg";
      const url = await uploadMedia(blob, ext);
      setMedia((arr) => arr.map((m, j) => (j === idx ? { ...m, url } : m)));
    } catch (e) { setMsg("Не удалось применить фильтр: " + (e as Error).message); }
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
    setSending(true); setMsg(""); setRetryFn(null);
    try {
      await updateScheduled(editingId, { ...payload(), publish_at: new Date(when).toISOString() });
      resetComposer(); setWhen(""); setMsg("Изменения сохранены ✓");
      setScheduled(await scheduledPosts().catch(() => []));
    } catch (e) { setMsg("Ошибка: " + (e as Error).message); setRetryFn({ run: doSaveEdit }); }
    finally { setSending(false); }
  }
  function payload() {
    return { chat_id: chatId, text: html.trim() || undefined, parse_mode: "HTML" as const, media, disable_preview: noPreview };
  }
  async function doSend() {
    if (!chatId) return;
    setSending(true); setMsg(""); setRetryFn(null);
    try {
      await sendPostNow(payload());
      resetComposer(); setMsg("Опубликовано ✓");
      setPosted(await postedList().catch(() => []));
    } catch (e) { setMsg("Ошибка: " + (e as Error).message); setRetryFn({ run: doSend }); }
    finally { setSending(false); }
  }
  async function doSchedule() {
    if (!chatId || !when) { setMsg("Укажите дату и время"); return; }
    setSending(true); setMsg(""); setRetryFn(null);
    try {
      await schedulePost({ ...payload(), publish_at: new Date(when).toISOString() });
      resetComposer(); setWhen(""); setMsg("Запланировано ✓");
      setScheduled(await scheduledPosts().catch(() => []));
    } catch (e) { setMsg("Ошибка: " + (e as Error).message); setRetryFn({ run: doSchedule }); }
    finally { setSending(false); }
  }

  const chOk = (cid: string) => filterChan === "all" || cid === filterChan;
  const schedShown = scheduled.filter((p) => chOk(p.chat_id));
  const postedShown = posted.filter((p) => chOk(p.chat_id));
  const empty = !html.trim() && media.length === 0;
  const mediaLabel = (m: PostMedia) =>
    m.type === "photo" ? "🖼 фото" : m.type === "video" ? "🎬 видео" : m.type === "voice" ? "🎤 голос"
    : m.type === "audio" ? `🎵 ${m.title || "музыка"}` : m.type === "videonote" ? "⭕ кружок" : `📎 ${m.name || "файл"}`;

  return (
    <>
      <TopBar title="Кабинет автора" />
      <div className="content">
        {msg && (
          <div className="card msg-card" style={{ fontSize: 13 }}>
            {msg}
            {retryFn && (
              <button className="btn sm" style={{ marginTop: 8 }} disabled={sending}
                onClick={() => retryFn.run()}>
                {sending ? "…" : "↻ Повторить отправку"}
              </button>
            )}
          </div>
        )}

        {!channels && <Loading />}

        {/* Онбординг — только пока нет ни одного канала */}
        {channels && channels.length === 0 && (
          <>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Публикуйте в свои каналы без VPN</h3>
              <p className="muted" style={{ fontSize: 14, marginBottom: 12 }}>
                Публиковать можно только в каналы, где вы сами админ.
              </p>
              <BotLinkHelp />
              <div className="field" style={{ marginTop: 12 }}>
                <label>@username канала</label>
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
            <RichEditor key={editorKey} initialHtml={initialHtml} onChange={setHtml} mentions={mentionList} placeholder="Текст поста — выделите текст и нажмите Ж/К/…" />

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
              <button className="btn secondary sm" onClick={() => setShowCirc(true)}>⭕ Кружок</button>
            </div>

            {showRec && <div style={{ marginTop: 8 }}><VoiceRecorder onDone={onVoice} onCancel={() => setShowRec(false)} /></div>}
            {showCirc && <CircleRecorder onDone={onCircle} onCancel={() => setShowCirc(false)} />}
            {filterFor != null && media[filterFor] && (media[filterFor].type === "photo" || media[filterFor].type === "video") && (
              <MediaFilterPicker
                type={media[filterFor].type as "photo" | "video"}
                url={media[filterFor].url}
                onDone={(blob) => onFiltered(blob, filterFor)}
                onCancel={() => setFilterFor(null)}
              />
            )}

            {media.length > 0 && (
              <div className="media-previews">
                {media.map((m, i) => {
                  const rm = () => setMedia((arr) => arr.filter((_, j) => j !== i));
                  if (m.type === "photo" || m.type === "video") {
                    return (
                      <div key={i} className="mp-thumb">
                        {m.type === "photo"
                          ? <img src={m.url} alt="" />
                          : <video src={m.url} controls playsInline preload="metadata" />}
                        <button className="mp-filter" onClick={() => setFilterFor(i)} aria-label="Фильтр" title="Стилевой фильтр">🎨</button>
                        <button className="mp-x" onClick={rm} aria-label="Убрать">✕</button>
                      </div>
                    );
                  }
                  // Кружок — круглое видео с плеером (можно посмотреть перед отправкой).
                  if (m.type === "videonote") {
                    return (
                      <div key={i} className="mp-thumb round">
                        <video src={m.url} controls playsInline preload="metadata" />
                        <button className="mp-x" onClick={rm} aria-label="Убрать">✕</button>
                      </div>
                    );
                  }
                  // Голосовое/музыка — плеер, чтобы прослушать перед отправкой.
                  if (m.type === "voice" || m.type === "audio") {
                    return (
                      <div key={i} className="mp-audio">
                        <span className="mp-audio-lbl">{mediaLabel(m)}</span>
                        <audio src={m.url} controls preload="none" />
                        <button className="chip-x" onClick={rm} aria-label="Убрать">✕</button>
                      </div>
                    );
                  }
                  return (
                    <span key={i} className="tag">{mediaLabel(m)}<button className="chip-x" onClick={rm}>✕</button></span>
                  );
                })}
              </div>
            )}

            <label className="check-row" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={noPreview} onChange={(e) => setNoPreview(e.target.checked)} />
              Не показывать превью ссылок
            </label>

            {editingId ? (
              <div className="field" style={{ marginTop: 10 }}>
                <label>Дата и время публикации</label>
                <div className="schedule-row">
                  <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
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
                  <div className="schedule-row">
                    <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                    <button className="btn secondary" onClick={doSchedule} disabled={sending || empty || !when}>Запланировать</button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Фильтр отложки/опубликованных по каналу */}
        {channels && channels.length > 1 && (scheduled.length > 0 || posted.length > 0) && (
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Показывать посты канала</label>
            <select value={filterChan} onChange={(e) => setFilterChan(e.target.value)}>
              <option value="all">Все каналы</option>
              {channels.map((c) => <option key={c.id} value={c.chat_id}>{c.title || c.chat_id}</option>)}
            </select>
          </div>
        )}

        {/* Запланированные — свёрнуто, с превью «как в ленте» */}
        {schedShown.length > 0 && (
          <details className="card fold">
            <summary>Запланировано ({schedShown.length})</summary>
            <div style={{ marginTop: 10, display: "grid", gap: 14 }}>
              {schedShown.map((p) => {
                const ch = channels?.find((c) => c.chat_id === p.chat_id);
                return (
                  <div key={p.id} style={{ minWidth: 0 }}>
                    <div style={{ marginBottom: 8 }}>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                        🕒 {new Date(p.publish_at).toLocaleString("ru-RU")}
                        {p.status === "failed" && " · ошибка"}
                      </div>
                      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
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

        {/* Опубликованные — по умолчанию за последнюю неделю; остальное по кнопке */}
        {postedShown.length > 0 && (() => {
          const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
          const recent = postedShown.filter((p) => new Date(p.sent_at).getTime() >= weekAgo);
          const older = postedShown.filter((p) => new Date(p.sent_at).getTime() < weekAgo);
          const list = showAllPosted ? postedShown : recent;
          return (
            <details className="card fold">
              <summary>Опубликованные ({postedShown.length})</summary>
              <div className="muted" style={{ fontSize: 12, margin: "6px 0" }}>
                {showAllPosted ? "Все посты." : "Посты за последнюю неделю."} Правка текста и удаление применяются прямо в Telegram-канале.
              </div>
              {list.map((p) => {
                const ch = channels?.find((c) => c.chat_id === p.chat_id);
                return <PostedItem key={p.id} post={p} channelName={ch?.title || p.chat_id} mentions={mentionList} onChanged={async () => setPosted(await postedList().catch(() => []))} onMsg={setMsg} />;
              })}
              {!showAllPosted && older.length > 0 && (
                <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setShowAllPosted(true)}>
                  Другие посты ({older.length}) ▾
                </button>
              )}
              {showAllPosted && older.length > 0 && (
                <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setShowAllPosted(false)}>
                  Свернуть до недели ▴
                </button>
              )}
            </details>
          );
        })()}

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
                    <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      <button className="btn ghost sm" onClick={() => setSettingsFor(settingsFor === c.id ? null : c.id)}>⚙ Настройки</button>
                      <button className="btn ghost sm" onClick={async () => {
                        setBusy(true); setMsg("");
                        try { await refreshChannel(c.chat_id); setMsg("Данные канала обновлены ✓"); await reload(); }
                        catch (e) { setMsg("Не удалось обновить: " + (e as Error).message); }
                        finally { setBusy(false); }
                      }} disabled={busy}>🔄 Обновить данные</button>
                      <button className="btn ghost sm" onClick={async () => { if (confirm("Отвязать канал?")) { await unlinkChannel(c.id); reload(); } }}>Отвязать</button>
                    </div>
                    {settingsFor === c.id && <ChannelSettings channel={c} onDone={() => setMsg("Изменения канала применены (если у бота есть права).")} />}
                  </div>
                </div>
              ))}
            </div>
            <details className="fold" style={{ marginTop: 12, border: "none", background: "none" }}>
              <summary style={{ padding: "6px 0" }}>+ Привязать ещё канал</summary>
              <BotLinkHelp />
              <div className="field" style={{ marginTop: 8 }}>
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
function PostedItem({ post, channelName, mentions, onChanged, onMsg }: { post: PostedMessage; channelName: string; mentions: string[]; onChanged: () => void; onMsg: (s: string) => void }) {
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

  const plain = (post.text || "").replace(/<[^>]+>/g, "").trim();
  return (
    <div style={{ borderTop: "1px solid var(--surface-2)", paddingTop: 10, marginTop: 10 }}>
      {!editing && (
        <>
          {/* Контент — на первом месте и крупно: посты узнают по тексту. */}
          <div
            style={{
              fontSize: 15, lineHeight: 1.35, whiteSpace: "pre-wrap", wordBreak: "break-word",
              display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}
          >
            {plain || "🖼 [медиа без текста]"}
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
            {channelName} · {new Date(post.sent_at).toLocaleString("ru-RU")}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {canEditText && <button className="btn ghost sm" onClick={() => setEditing(true)} disabled={busy}>Изменить текст</button>}
            <button className="btn ghost sm" onClick={del} disabled={busy}>Удалить</button>
          </div>
        </>
      )}
      {editing && (
        <div style={{ marginTop: 8 }}>
          <RichEditor initialHtml={post.text || ""} onChange={setHtml} mentions={mentions} />
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn sm" onClick={save} disabled={busy}>{busy ? "…" : "Сохранить"}</button>
            <button className="btn ghost sm" onClick={() => setEditing(false)}>Отмена</button>
          </div>
        </div>
      )}
    </div>
  );
}
