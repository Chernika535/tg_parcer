import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createFeed, updateFeed, getFeedById, type Visibility } from "../lib/data.ts";
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
  const [channels, setChannels] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<Visibility>("private");
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
        setChannels(f.channels);
        setVisibility(f.visibility);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [isNew, feedId]);

  async function save() {
    if (!title.trim()) {
      setErr("Укажите название");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      if (isNew) await createFeed({ title, channels, visibility });
      else await updateFeed(feedId, { title: title.trim(), channels, visibility });
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
          <label>Название</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="field">
          <label>Каналы</label>
          <ChannelInput channels={channels} onChange={setChannels} />
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

        <button className="btn" onClick={save} disabled={saving}>
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
    </>
  );
}
