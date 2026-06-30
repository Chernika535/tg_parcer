import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { readChannels, readChannelsMTServer, readChannelsMT, type Post } from "../lib/data.ts";
import { Loading, Empty, TopBar } from "../components/States.tsx";
import PostCard from "../components/PostCard.tsx";

// Отдельная страница поста — для ссылок «поделиться постом» внутри сервиса.
export default function PostView() {
  const { channel = "", msgId = "" } = useParams();
  const id = Number(msgId);
  const nav = useNavigate();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const find = (posts: Post[]) => posts.find((p) => p.channel === channel && p.msgId === id) ?? null;
      try {
        // Открытый канал.
        const r = await readChannels([channel]);
        let p = find(r.posts);
        // Закрытый канал — пробуем через MTProto (сервер, затем браузер).
        if (!p && r.unavailable.includes(channel)) {
          const srv = await readChannelsMTServer([channel]);
          p = find(srv.posts);
          if (!p) {
            const br = await readChannelsMT([channel]);
            p = find(br.posts);
          }
        }
        setPost(p);
      } catch {
        setPost(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [channel, id]);

  return (
    <>
      <TopBar title="Пост" onBack={() => nav(-1)} />
      <div className="content">
        {loading && <Loading label="Загружаю пост…" />}
        {!loading && post && <PostCard post={post} />}
        {!loading && !post && (
          <Empty>
            Пост не найден в свежих записях канала.{" "}
            <a className="ln" href={`https://t.me/${channel}/${id}`} target="_blank" rel="noreferrer">
              Открыть в Telegram ↗
            </a>
          </Empty>
        )}
      </div>
    </>
  );
}
