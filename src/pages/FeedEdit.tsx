import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createFeed, updateFeed, getFeedById, uploadCover, publicFeeds, myFeeds, type Visibility } from "../lib/data.ts";
import CoverArt from "../components/CoverArt.tsx";
import TagInput from "../components/TagInput.tsx";
import CoverCropper, { TARGET_W, TARGET_H } from "../components/CoverCropper.tsx";
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
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [authorName, setAuthorName] = useState("");
  const [channels, setChannels] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [official, setOfficialFlag] = useState(false);
  const [byAdmin, setByAdmin] = useState(false);
  const [adult, setAdult] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  // Существующие теги — для подсказок (из публичных и своих лент).
  useEffect(() => {
    (async () => {
      const pub = await publicFeeds().catch(() => []);
      const mine = await myFeeds().catch(() => []);
      const m = new Map<string, number>();
      for (const f of [...pub, ...mine]) for (const t of f.tags || []) m.set(t, (m.get(t) || 0) + 1);
      setAllTags([...m.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t));
    })();
  }, []);

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
        setAdult(f.adult);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [isNew, feedId]);

  // Сначала показываем кадрирование, а грузим уже обрезанное фото.
  function onPickCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCropFile(file);
  }
  async function onCropped(blob: Blob) {
    setCropFile(null);
    setUploading(true);
    setErr("");
    try {
      setCoverUrl(await uploadCover(new File([blob], "cover.png", { type: "image/png" })));
    } catch (e) {
      setErr("Не удалось загрузить фото: " + (e as Error).message);
    } finally {
      setUploading(false);
    }
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
        adult,
      };
      if (isNew) await createFeed(payload);
      else await updateFeed(feedId, payload);
      nav(-1);
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  if (loading) return <Loading />;

  return (
    <>
      <TopBar title={isNew ? "Новая лента" : "Лента"} onBack={() => nav(-1)} />
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
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                Рекомендуемый размер — {TARGET_W}×{TARGET_H} px (5:3). После выбора фото можно подвигать и приблизить нужную область.
              </div>
            </div>
          </div>
        </div>

        {cropFile && <CoverCropper file={cropFile} onDone={onCropped} onCancel={() => setCropFile(null)} />}

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
          <TagInput tags={tags} onChange={setTags} suggestions={allTags} />
        </div>

        <div className="field">
          <label>Возрастное ограничение</label>
          <label className="check">
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
            <span>18+ — контент для взрослых или нецензурная лексика</span>
          </label>
          <p className="muted" style={{ fontSize: 12 }}>
            Такую ленту откроют только после подтверждения возраста. Пользователям младше 18 (или без указанной даты рождения) её посты не показываются в избранном и лентах по тегам.
          </p>
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
