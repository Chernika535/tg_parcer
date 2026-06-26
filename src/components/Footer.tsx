import { Link } from "react-router-dom";

// Email и анкеты — заполнятся позже (ссылки-заглушки).
const AUTHOR_EMAIL = "author@example.com"; // TODO: заменить на реальный
const ADD_CHANNEL_URL = "#"; // TODO: ссылка на анкету «добавить канал»
const ADD_FEED_URL = "#"; // TODO: ссылка на анкету «добавить подборку»

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-links">
        <Link to="/privacy">Политика конфиденциальности</Link>
        <Link to="/data-policy">Обработка персональных данных</Link>
        <a href={ADD_CHANNEL_URL}>Добавить канал</a>
        <a href={ADD_FEED_URL}>Добавить подборку</a>
        <a href={`mailto:${AUTHOR_EMAIL}`}>Связаться с автором</a>
      </div>
      <div className="footer-copy">© {new Date().getFullYear()} Telegram Feed Aggregator</div>
    </footer>
  );
}
