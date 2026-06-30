import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadPublic, type Feed } from "../lib/data.ts";
import { useAuth } from "../lib/auth.tsx";
import CoverArt from "../components/CoverArt.tsx";

export default function Landing() {
  const nav = useNavigate();
  const { session } = useAuth();
  const [feeds, setFeeds] = useState<Feed[]>([]);

  useEffect(() => {
    loadPublic().then((d) => setFeeds(d.feeds.slice(0, 20))).catch(() => {});
  }, []);

  return (
    <div className="content landing">
      <section className="hero">
        <h1 className="hero-title">Полистай</h1>
        <p className="hero-sub">
          Лента публичных Telegram-каналов в одном месте. Подборки по темам, поиск,
          избранное и закрытые каналы — без переключений между чатами.
        </p>
        <div className="hero-actions">
          <button className="btn" onClick={() => nav("/feeds")}>Смотреть ленты</button>
          {session ? (
            <button className="btn secondary" onClick={() => nav("/favorites")}>Избранное</button>
          ) : (
            <button className="btn secondary" onClick={() => nav("/login")}>Войти</button>
          )}
        </div>
      </section>

      {feeds.length > 0 && (
        <section>
          <div className="row spread" style={{ marginBottom: 8 }}>
            <h2 className="sec-title">Готовые подборки</h2>
            <button className="btn ghost sm" onClick={() => nav("/feeds")}>все →</button>
          </div>
          <div className="hscroll">
            {feeds.map((f) => (
              <button key={f.id} className="hcard" onClick={() => nav(`/feed/${f.id}`)}>
                <CoverArt seed={`${f.title}${f.id}`} src={f.cover_url} className="hcard-cover" />
                <div className="hcard-title">{f.title}</div>
                <div className="muted" style={{ fontSize: 12 }}>{f.channels.length} каналов</div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="how">
        <h2 className="sec-title">Как это работает</h2>
        <ul className="how-list">
          <li>📚 Объединяйте любимые каналы в подборки-ленты</li>
          <li>🔎 Ищите по темам и тегам, фильтруйте</li>
          <li>♥ Сохраняйте посты и целые ленты в избранное</li>
          <li>🔒 Читайте каналы с защитой от копирования (после входа)</li>
        </ul>
      </section>
    </div>
  );
}
