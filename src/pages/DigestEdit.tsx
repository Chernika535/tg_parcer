import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api.ts";
import { Loading, ErrorState, TopBar } from "../components/States.tsx";
import ChannelInput from "../components/ChannelInput.tsx";
import TimePicker from "../components/TimePicker.tsx";

export default function DigestEdit() {
  const { id } = useParams();
  const isNew = !id;
  const digestId = Number(id);
  const nav = useNavigate();

  const [title, setTitle] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [kwInput, setKwInput] = useState("");
  const [channels, setChannels] = useState<string[]>([]);
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(!isNew);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const list = await api.listDigests();
        const d = list.find((x) => x.id === digestId);
        if (!d) throw new Error("парсинг не найден");
        setTitle(d.title);
        setKeywords(d.keywords);
        setChannels(d.channels);
        setHour(d.send_hour);
        setMinute(d.send_minute);
        setEnabled(d.enabled);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [isNew, digestId]);

  function addKw() {
    const k = kwInput.trim().toLowerCase();
    if (k && !keywords.includes(k)) setKeywords([...keywords, k]);
    setKwInput("");
  }

  async function save() {
    if (!title.trim()) {
      setErr("Укажите название");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const payload = { title: title.trim(), keywords, channels, send_hour: hour, send_minute: minute, enabled };
      if (isNew) await api.createDigest(payload);
      else await api.updateDigest(digestId, payload);
      nav("/digests");
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Удалить парсинг?")) return;
    await api.deleteDigest(digestId);
    nav("/digests");
  }

  if (loading) return <Loading />;

  return (
    <>
      <TopBar title={isNew ? "Новый парсинг" : "Парсинг"} onBack={() => nav("/digests")} />
      <div className="content">
        {err && <ErrorState message={err} />}

        <div className="field">
          <label>Название</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="field">
          <label>Ключевые слова (пусто = все посты проходят)</label>
          <div className="row">
            <input
              type="text"
              value={kwInput}
              onChange={(e) => setKwInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addKw();
                }
              }}
              placeholder="слово и Enter"
            />
            <button type="button" className="btn sm" onClick={addKw}>
              +
            </button>
          </div>
          <div className="tags">
            {keywords.map((k) => (
              <span key={k} className="tag">
                {k}
                <button type="button" onClick={() => setKeywords(keywords.filter((x) => x !== k))}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Каналы-источники</label>
          <ChannelInput channels={channels} onChange={setChannels} />
        </div>

        <div className="field">
          <label>Время отправки (локальное)</label>
          <TimePicker
            hour={hour}
            minute={minute}
            onChange={(h, m) => {
              setHour(h);
              setMinute(m);
            }}
          />
        </div>

        <div className="field row spread">
          <label style={{ margin: 0 }}>Включён</label>
          <label className="switch">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span />
          </label>
        </div>

        <button className="btn" onClick={save} disabled={saving}>
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
        {!isNew && (
          <button className="btn danger" style={{ marginTop: 10 }} onClick={remove}>
            Удалить
          </button>
        )}
      </div>
    </>
  );
}
