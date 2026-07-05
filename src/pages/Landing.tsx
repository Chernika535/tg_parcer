import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadPublic, type Feed, type Pin } from "../lib/data.ts";
import { useAuth } from "../lib/auth.tsx";
import CoverArt from "../components/CoverArt.tsx";

const FAQ: { q: string; a: string }[] = [
  { q: "Нужен ли VPN?", a: "Нет. Весь доступ к Telegram идёт через наш сервер, поэтому VPN не требуется." },
  { q: "Нужно что-то скачивать?", a: "Нет, всё работает в браузере. Можно «установить» как приложение на телефон — появится ярлык на экране." },
  { q: "Как войти?", a: "Через Telegram или по e-mail и паролю. Вход через Telegram нужен только авторам для публикации в своих каналах через наш сервис. Чтобы читать посты и создавать ленты, иметь аккаунт в Telegram не обязательно." },
  { q: "Что такое лента?", a: "Тематическая подборка из нескольких каналов. Можно открывать готовые ленты и создавать свои, как личные, так и общедоступные." },
  { q: "Могу ли я вести свой канал через сервис?", a: "Да. Добавьте нашего бота администратором канала — и публикуйте посты, в том числе по расписанию, без VPN." },
  { q: "Это безопасно для моего канала?", a: "Да. Мы не просим пароль и не входим в аккаунт. Постинг идёт через официального бота, которого вы в любой момент можете снять с админов." },
  { q: "Сколько это стоит?", a: "Сейчас бесплатно." },
];

export default function Landing() {
  const nav = useNavigate();
  const { session } = useAuth();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [pins, setPins] = useState<Pin[]>([]);

  useEffect(() => {
    loadPublic().then((d) => { setFeeds(d.feeds); setPins(d.pins); }).catch(() => {});
  }, []);

  // Популярные теги — топ-10 по числу подборок.
  const topTags = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of feeds) for (const t of f.tags ?? []) m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t);
  }, [feeds]);

  // Последние 5 лент, закреплённые администратором — первыми.
  const examples = useMemo(() => {
    const pinned = new Set(pins.map((p) => p.feed_id));
    return [...feeds].sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id))).slice(0, 5);
  }, [feeds, pins]);

  return (
    <div className="content landing">
      {/* Hero */}
      <section className="hero">
        <h1 className="hero-title">Telegram-каналы. Удобными лентами. Без VPN.</h1>
        <p className="hero-sub">
          Читайте любимые каналы в одном месте и находите лучшие подборки по интересам.
          Авторам — постинг и отложка без VPN.
        </p>
      </section>

      {/* Свежие ленты — горизонтальная карусель, закреплённые первыми */}
      {examples.length > 0 && (
        <section>
          <h2 className="sec-title" style={{ marginBottom: 8 }}>Свежие ленты</h2>
          <div className="hscroll">
            {examples.map((f) => (
              <button key={f.id} className="hcard" onClick={() => nav(`/feed/${f.id}`)}>
                <CoverArt seed={`${f.title}${f.id}`} src={f.cover_url} className="hcard-cover" />
                <div className="hcard-title">{f.title}</div>
                <div className="muted" style={{ fontSize: 12 }}>{f.channels.length} каналов</div>
              </button>
            ))}
          </div>
          <button className="btn ghost sm" style={{ marginTop: 4 }} onClick={() => nav("/feeds")}>Все ленты →</button>
        </section>
      )}

      {/* Популярные теги */}
      {topTags.length > 0 && (
        <section>
          <h2 className="sec-title" style={{ marginBottom: 8 }}>Популярные темы</h2>
          <div className="chip-row" style={{ flexWrap: "wrap" }}>
            {topTags.map((t) => (
              <button key={t} className="chip" onClick={() => nav(`/tag/${encodeURIComponent(t)}`)}>#{t}</button>
            ))}
          </div>
        </section>
      )}

      {/* Проблема */}
      <section className="land-block accent-block">
        <h2 className="sec-title">Telegram сегодня — это боль</h2>
        <p>Замедления, не грузятся картинки, не открываются каналы, не показывается вход.
          А ещё — десятки каналов и полный хаос в ленте. И ведь именно здесь масса интересных
          авторов публикуют свой контент каждый день! Но как их найти? <b>Полистай решает все
          три эти проблемы.</b></p>
      </section>

      {/* Как это работает */}
      <section className="land-block">
        <h2 className="sec-title">Как это работает</h2>
        <ol className="how-steps">
          <li><span className="how-num">1</span> Открываете подборку — тематическую ленту из собранных администратором или другими пользователями каналов.</li>
          <li><span className="how-num">2</span> Читаете без VPN — весь доступ идёт через наш сервер.</li>
          <li><span className="how-num">3</span> Собираете своё — избранное, папки, свои подборки.</li>
        </ol>
      </section>

      {/* Яркий призыв — создавай ленты */}
      <section className="land-invite">
        <div className="land-invite-title">Знаете интересные каналы?</div>
        <p>Создавайте свои общедоступные ленты и делитесь находками с другими!</p>
        <button className="btn" onClick={() => nav(session ? "/my/new" : "/login")}>Создать ленту</button>
      </section>

      {/* Для читателей / авторов */}
      <section className="land-cols">
        <div className="land-col">
          <h3 className="sec-title">Читайте с удовольствием</h3>
          <ul className="dot-list">
            <li>Тематические подборки каналов</li>
            <li>Единая лента, избранное с папками, поиск по тегам</li>
            <li>Страницы каналов с описанием</li>
            <li>Работает без VPN и лишних установок, заходите как в веб-приложение прямо в браузере</li>
          </ul>
          <button className="btn secondary sm" onClick={() => nav("/feeds")}>Открыть подборки</button>
        </div>
        <div className="land-col">
          <h3 className="sec-title">Ведите канал откуда угодно</h3>
          <ul className="dot-list">
            <li>Публикуйте без VPN — через бота-администратора</li>
            <li>Форматирование, альбомы до 10 медиа, музыка, файлы, голосовые</li>
            <li>Отложенные посты с расписанием</li>
            <li>Правьте и удаляйте опубликованное через наш сервис</li>
          </ul>
          <button className="btn secondary sm" onClick={() => nav(session ? "/author" : "/login")}>Кабинет автора</button>
        </div>
      </section>

      {/* Почему безопасно */}
      <section className="land-block">
        <h2 className="sec-title">Ваш аккаунт остаётся вашим</h2>
        <p>Вы просто входите в наш сервис через свой аккаунт в Telegram. Для публикации вы
          добавляете нашего бота администратором канала — и в любой момент можете убрать его.
          Постинг идёт через официальный Telegram Bot API, без риска блокировки аккаунта.</p>
      </section>

      {/* FAQ */}
      <section className="land-block">
        <h2 className="sec-title">Частые вопросы</h2>
        <div className="faq">
          {FAQ.map((f) => (
            <details key={f.q} className="faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Финальный CTA */}
      <section className="land-cta">
        <h2 className="sec-title">Начните листать</h2>
        <p className="muted">Бесплатно. Без VPN. В браузере.</p>
        <button className="btn" onClick={() => nav(session ? "/feeds" : "/login")}>Открыть Полистай</button>
      </section>
    </div>
  );
}
