import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, type FeedDetail } from "../api.ts";
import { Loading, ErrorState, Empty, TopBar } from "../components/States.tsx";
import PostCard from "../components/PostCard.tsx";
import ChannelInput from "../components/ChannelInput.tsx";

export default function FeedView() {
  const { id } = useParams();
  const feedId = Number(id);
  const nav = useNavigate();
  const [data, setData] = useState<FeedDetail | null>(null);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [channels, setChannels] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    try {
      const d = await api.getFeed(feedId);
      setData(d);
      setChannels(d.feed.channels);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [feedId]);

  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function saveChannels() {
    await api.updateFeed(feedId, { channels });
    setEditing(false);
    refresh();
  }

  const unavailable =
    data && channels.filter((c) => !data.posts.some((p) => p.channel === c));

  return (
    <>
      <TopBar title={data?.feed.title || "Лента"} onBack={() => nav("/feeds")} />
      <div className="content">
        <div className="row spread">
          <button className="btn secondary sm" onClick={() => setEditing((v) => !v)}>
            {editing ? "Отмена" : "✎ Каналы"}
          </button>
          <button className="btn ghost sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? "Обновление…" : "↻ Обновить"}
          </button>
        </div>

        {editing && (
          <div className="card">
            <label>Каналы ленты</label>
            <ChannelInput channels={channels} onChange={setChannels} />
            <button className="btn" style={{ marginTop: 12 }} onClick={saveChannels}>
              Сохранить
            </button>
          </div>
        )}

        {!editing && unavailable && unavailable.length > 0 && (
          <div className="card">
            <div className="muted">Недоступны (превью отключено / приватный / удалён):</div>
            <div className="tags">
              {unavailable.map((c) => (
                <span key={c} className="tag">
                  @{c} <span className="badge warn">недоступен</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {err && <ErrorState message={err} onRetry={load} />}
        {!data && !err && <Loading label="Читаю каналы…" />}
        {data && data.posts.length === 0 && channels.length > 0 && !err && (
          <Empty>Постов пока нет. Попробуйте обновить.</Empty>
        )}
        {data && channels.length === 0 && !editing && (
          <Empty>Добавьте каналы через «✎ Каналы».</Empty>
        )}
        {data?.posts.map((p) => (
          <PostCard key={`${p.channel}/${p.msgId}`} post={p} />
        ))}
      </div>
    </>
  );
}
