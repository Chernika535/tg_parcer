import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createFeed, updateFeed, getFeedById, cleanTags, uploadCover, type Visibility } from "../lib/data.ts";
import CoverArt from "../components/CoverArt.tsx";
import { useAuth } from "../lib/auth.tsx";
import { Loading, ErrorState, TopBar } from "../components/States.tsx";
import ChannelInput from "../components/ChannelInput.tsx";

export default function FeedEdit() {
  const { id } = useParams();
  const isNew = !id;
  const feedId = Number(id);
  const nav = useNavigate();
  const { isAdmin } = useAuth();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [authorName, setAuthorName] = useState("");
  const [channels, setChannels] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [official, setOfficialFlag] = useState(false);
  const [byAdmin, setByAdmin] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const f = await getFeedById(feedId);
        if (!f) throw new Error("лента не найдена");
        setTitle(f.title);
        setDescription(f.description || "");
        setCoverUrl(f.cover_url);
        setAuthorName(f.author_name || "");
        setChannels(f.channels);
        setTags(f.tags || []);
        setVisibility(f.visibility);
        setOfficialFlag(f.official);
        setByAdmin(f.by_admin);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [isNew, feedId]);

  async function onPickCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setErr("");
    try {
      setCoverUrl(await uploadCover(file));
    } catch (e) {
      setErr("Не удалось загрузить фото: " + (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function addTag() {
    const next = cleanTags([...tags, tagInput]);
    setTags(next);
    setTagInput("");
  }

  async function save() {
    if (!title.trim()) {
      setErr("Укажите название");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        cover_url: coverUrl,
        author_name: visibility === "public" ? authorName.trim() || null : null,
        channels,
        visibility,
        tags,
        official: isAdmin ? official : false,
        by_admin: isAdmin ? byAdmin : false,
      };
      if (isNew) await createFeed(payload);
      else await updateFeed(feedId, payload);
      nav("/my");
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  if (loading) return <Loading />;

  return (
    <>
      <TopBar title={isNew ? "Новая лента" : "Лента"} onBack={() => nav("/my")} />
      <div className="content">
        {err && <ErrorState message={err} />}
        <div className="field">
          <label>Обложка</label>
          <div className="cover-edit">
            <CoverArt seed={`${title}${feedId}`} src={coverUrl} className="cover-edit-art" />
            <div className="cover-edit-actions">
              <label className="btn secondary sm" style={{ cursor: "pointer" }}>
                {uploading ? "Загрузка…" : coverUrl ? "Заменить фото" : "Загрузить фото"}
                <input type="file" accept="image/*" hidden onChange={onPickCover} disabled={uploading} />
              </label>
              {coverUrl && (
                <button type="button" className="btn ghost sm" onClick={() => setCoverUrl(null)}>
                  Убрать (будет авто-узор)
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="field">
          <label>Название</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="field">
          <label>Описание (до 300 символов)</label>
          <textarea
            value={description}
            maxLength={300}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="О чём эта подборка"
          />
          <div className="muted" style={{ textAlign: "right" }}>{description.length}/300</div>
        </div>

        <div className="field">
          <label>Каналы</label>
          <ChannelInput channels={channels} onChange={setChannels} />
        </div>

        <div className="field">
          <label>Теги (темы: психология, фандомы, новости…)</label>
          <div className="row">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="тег и Enter"
            />
            <button type="button" className="btn sm" onClick={addTag}>
              +
            </button>
          </div>
          <div className="tags">
            {tags.map((t) => (
              <span key={t} className="chip">
                #{t}
                <button type="button" className="chip-x" onClick={() => setTags(tags.filter((x) => x !== t))}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Доступ</label>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
            <option value="private">Приватная (только я)</option>
            <option value="public">Общедоступная</option>
          </select>
          {visibility === "public" && !isAdmin && (
            <p className="muted">
              Общедоступная лента попадёт на модерацию. После одобрения её увидят все.
            </p>
          )}
          {visibility === "public" && isAdmin && (
            <p className="muted">Как админ, вы публикуете ленту сразу, без модерации.</p>
          )}
        </div>

        {visibility === "public" && (
          <div className="field">
            <label>Имя автора подборки (необязательно)</label>
            <input
              type="text"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="например: Ника / Канал ХХХ"
            />
          </div>
        )}

        {isAdmin && (
          <div className="field">
            <label>Бейджи (только админ)</label>
            <label className="check">
              <input type="checkbox" checked={byAdmin} onChange={(e) => setByAdmin(e.target.checked)} />
              <span>Показать бейдж «от админа»</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={official} onChange={(e) => setOfficialFlag(e.target.checked)} />
              <span>Отметить «официальный источник»</span>
            </label>
          </div>
        )}

        <button className="btn" onClick={save} disabled={saving}>
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
    </>
  );
}
