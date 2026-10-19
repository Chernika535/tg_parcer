import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadPublic, type Feed, type Pin } from "../lib/data.ts";
import { useAuth } from "../lib/auth.tsx";
import CoverArt from "../components/CoverArt.tsx";
import "./Landing.css";

const faq = [
  ["Что вообще такое Полистай?", "Независимый веб-сервис для чтения публичных Telegram-каналов. Здесь можно находить готовые подборки, собирать собственные ленты, читать публикации и делиться своими находками."],
  ["Мне нужен аккаунт Telegram?", "Для чтения доступных публичных каналов — нет. Для некоторых функций самого сервиса может понадобиться регистрация."],
  ["А без VPN работает?", "Полистай позволяет читать доступные публичные Telegram-каналы через браузер, не открывая Telegram. Доступность сайта зависит от интернет-провайдера и сетевых ограничений."],
  ["Можно читать закрытые каналы?", "Нет. Полистай работает с публичными Telegram-каналами, данные которых доступны сервису. Личные переписки и закрытые каналы он не открывает."],
  ["Как создать свою подборку?", "Создай ленту, добавь в неё публичные Telegram-каналы, придумай название и настрой оформление. После этого можешь читать её сам или сделать публичной."],
  ["Другие увидят мою ленту?", "Только если она публичная. Личные ленты не предназначены для общего доступа."],
  ["Можно сохранить интересные публикации?", "Да. Для этого есть избранное и папки."],
  ["Можно ли вести Telegram-канал через Полистай?", "Да. Для этого предусмотрен редактор с публикацией через Telegram Bot API. Понадобится подключить своего бота и выдать ему необходимые права в канале."],
  ["Это бесплатно?", "Сейчас Полистай бесплатный."],
  ["Полистай — часть Telegram?", "Нет. Это независимый проект, который работает с публичным Telegram-контентом и использует Telegram Bot API для инструментов публикации."],
] as const;

function FeedTile({ feed, className = "" }: { feed: Feed; className?: string }) {
  return <Link to={`/feed/${feed.id}`} className={`editorial-tile ${className}`}>
    <div className="editorial-tile-image"><CoverArt seed={`${feed.title}${feed.id}`} src={feed.cover_url} className="editorial-cover" /></div>
    <div className="editorial-tile-copy"><span className="editorial-tile-count">{feed.channels?.length || 0} каналов ↗</span>
      <strong>{feed.title}</strong><span>{feed.description || "Подборка Telegram-каналов"}</span></div>
  </Link>;
}

export default function Landing() {
  const { session } = useAuth();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [pins, setPins] = useState<Pin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    loadPublic().then((data) => { if (active) { setFeeds(data.feeds); setPins(data.pins); } })
      .catch(() => { if (active) setError("Не удалось загрузить подборки."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const featured = useMemo(() => {
    const ids = new Set(pins.map((pin) => pin.feed_id));
    return [...feeds].sort((a,b) => Number(ids.has(b.id)) - Number(ids.has(a.id))).slice(0, 12);
  }, [feeds, pins]);
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const feed of feeds) for (const tag of feed.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
    return [...counts].sort((a,b) => b[1] - a[1]).slice(0, 12).map(([tag]) => tag);
  }, [feeds]);
  const createUrl = session ? "/my/new" : "/login";
  const authorUrl = session ? "/author" : "/login";
  const editorial = featured.find((f) => f.official || f.by_admin) || featured[0];

  return <div className="editorial-landing">
    <section className="editorial-hero" aria-labelledby="editorial-h1">
      <div className="editorial-hero-top"><span>ПОЛИСТАЙ®</span><span>ПОКАЖИ, ЧТО ЛИСТАЕШЬ. ↗</span></div>
      <span className="editorial-index">01 / НАЧНИ ЗДЕСЬ</span>
      <h1 id="editorial-h1">У каждого<br /><em>свой</em> интернет<span className="editorial-period">.</span></h1>
      <div className="editorial-hero-bottom"><div><h2>А какой у тебя?</h2><p>Кто-то залипает в искусство. Кто-то ищет новую музыку, следит за модой или собирает странные находки со всего интернета.</p><p>Мы все читаем разное. И это интересно.</p><p>Полистай — место, где можно находить Telegram-каналы, собирать их в свои ленты и заглядывать в подборки других людей.</p></div>
        <div className="editorial-actions"><Link className="editorial-button editorial-button-dark" to="/feeds">Заглянуть в чужой интернет ↗</Link><Link className="editorial-text-link" to={createUrl}>Собрать свой →</Link><small>Бесплатно · Прямо в браузере · Без установки</small></div></div>
      {featured.length > 0 && <div className="editorial-mosaic" aria-label="Реальные подборки">{featured.slice(0,4).map((f,i) => <FeedTile key={f.id} feed={f} className={`mosaic-${i}`} />)}</div>}
      <div className="editorial-marquee" aria-hidden="true"><span>ЛИСТАЙ НЕ КАК ВСЕ ✳ СОБИРАЙ СВОЁ ✳ ЛИСТАЙ НЕ КАК ВСЕ ✳ СОБИРАЙ СВОЁ ✳ </span></div>
    </section>

    <section id="collections" className="editorial-section editorial-showcase">
      <div className="editorial-section-head"><span className="editorial-index">02 / ВИТРИНА ПОДБОРОК</span><h2>А что листают <i>другие?</i></h2><p>Чужие интересы — отдельный вид искусства. Загляни в готовые подборки. Возможно, найдёшь что-то, о существовании чего даже не подозревал.</p></div>
      {featured.length ? <div className="editorial-carousel">{featured.map((f) => <FeedTile key={f.id} feed={f} />)}</div> : <p className="editorial-state">{loading ? "Загружаем настоящие подборки…" : error || "Публичных подборок пока нет."}</p>}
      <Link className="editorial-arrow-link" to="/feeds">Смотреть все подборки <span>↗</span></Link>
    </section>

    <section className="editorial-section editorial-create">
      <span className="editorial-index">03 / СВОЯ ЛЕНТА</span>
      <div className="editorial-create-grid"><div><h2>Твой вкус.<br /><i>Твои правила.</i></h2><strong>Не обязательно быть блогером, чтобы было чем поделиться.</strong><p>Собери любимые Telegram-каналы в одну ленту. Придумай название, выбери обложку, добавь описание.</p><p>Можешь оставить её для себя. А можешь сделать публичной и отправить кому угодно.</p><p>Что ты читаешь — тоже часть тебя.</p><Link className="editorial-button editorial-button-lime" to={createUrl}>Создать свою ленту ↗</Link></div><div className="editorial-type-art" aria-label="Собрал. Назвал. Поделился."><span>СОБРАЛ.</span><span>НАЗВАЛ.</span><span>ПОДЕЛИЛСЯ.</span><div className="editorial-mini-ui"><span>НОВАЯ ЛЕНТА</span><div>Название подборки</div><div>Описание твоего интернета…</div><b>+ Добавить канал</b></div></div></div>
    </section>

    <section className="editorial-section editorial-people">
      <span className="editorial-index">04 / ЧУЖОЙ ИНТЕРНЕТ</span><div className="editorial-people-grid"><div><h2>Можно к тебе<br /><i>в голову?</i></h2><p>У каждого есть свои любимые каналы. Те, которые не хочется потерять среди сотни подписок.</p><p>Мы хотим узнавать, что читают дизайнеры, иллюстраторы, фотографы, студенты, редакторы и просто люди с интересным вкусом.</p><strong>«Чужой интернет» — подборки от людей, которым есть что показать.</strong><p>Пока здесь редакционные и публичные ленты Полистай. По мере появления участников — авторские подборки с разрешения создателей.</p><p>А может, начнём с твоей?</p><Link className="editorial-arrow-link" to={createUrl}>Показать свой интернет ↗</Link></div><div className="editorial-people-feature">{editorial ? <><FeedTile feed={editorial} /><span className="editorial-feature-label">{editorial.author_name ? `АВТОР: ${editorial.author_name}` : "ИЗ ПУБЛИЧНЫХ ПОДБОРОК"}</span></> : <div className="editorial-empty-feature">ТВОЙ<br />ИНТЕРНЕТ<br />ЗДЕСЬ ↗</div>}</div></div>
    </section>

    <section className="editorial-section editorial-features"><span className="editorial-index">05 / САМ ПРОДУКТ</span><h2>Меньше переключений.<br /><i>Больше интересного.</i></h2><div className="editorial-feature-grid"><article><span>01 ↗</span><h3>Одна лента вместо двадцати каналов.</h3><p>Добавляй публичные Telegram-каналы в свои подборки и читай их публикации в одном потоке.</p></article><article><span>02 ↗</span><h3>Нашёл что-то хорошее? Не теряй.</h3><p>Сохраняй публикации в избранное и раскладывай по папкам.</p></article><article><span>03 ↗</span><h3>Хочешь поделиться? Делись.</h3><p>У публичной подборки есть ссылка. Отправляй её кому захочешь.</p></article><article><span>04 ↗</span><h3>И всё это в браузере.</h3><p>Ничего устанавливать не нужно. Открывай Полистай на телефоне или компьютере.</p></article></div><Link className="editorial-button editorial-button-dark" to="/feeds">Попробовать Полистай ↗</Link></section>

    <section className="editorial-section editorial-topics"><span className="editorial-index">06 / ИССЛЕДОВАНИЕ ТЕМ</span><h2>Куда занесёт <i>сегодня?</i></h2><p>Искусство? Книги? Дизайн? Мода? Кино? Или что-то совсем неожиданное?</p><div className="editorial-tag-cloud">{tags.length ? tags.map((tag,i) => <Link key={tag} className={`editorial-tag tag-${i%4}`} to={`/tag/${encodeURIComponent(tag)}`}>#{tag} ↗</Link>) : <span>Темы появятся вместе с публичными подборками.</span>}</div><Link className="editorial-arrow-link" to="/tags">Исследовать темы ↗</Link></section>

    <section className="editorial-section editorial-authors"><span className="editorial-index">07 / ДЛЯ АВТОРОВ КАНАЛОВ</span><div><h2>Не только листать.<br /><i>Ещё и писать.</i></h2><p>Ведёшь Telegram-канал? В Полистай есть инструменты для публикации: редактор постов, работа с медиа, отложенная публикация и управление материалами через подключённого Telegram-бота. Всё прямо из браузера.</p><Link className="editorial-arrow-link" to={authorUrl}>Инструменты для авторов ↗</Link></div><div className="editorial-author-visual" aria-hidden="true"><div className="editorial-editor-head">РЕДАКТОР / НОВЫЙ ПОСТ <span>● ● ●</span></div><div className="editorial-editor-tools">B　I　U　≡　↗　▧</div><div className="editorial-editor-line" /><div className="editorial-editor-line short" /><div className="editorial-editor-photo">+ МЕДИА</div></div></section>

    <section id="faq" className="editorial-section editorial-faq"><span className="editorial-index">08 / FAQ</span><h2>Ладно, а как<br /><i>это работает?</i></h2><div className="editorial-faq-list">{faq.map(([q,a],i) => <details key={q}><summary><span>{String(i+1).padStart(2,"0")}</span>{q}<b>+</b></summary><p>{a}</p></details>)}</div></section>

    <section className="editorial-finale"><span className="editorial-index">09 / ТВОЙ ХОД</span><h2>Ну что,<br /><i>покажешь?</i></h2><p>У тебя наверняка есть пара каналов, о которых должны узнать остальные. Или хочется заглянуть в чужие подборки и найти что-то новое.</p><strong>Не держи хороший интернет при себе.</strong><div className="editorial-finale-brand">ПОЛИСТАЙ<span>↗</span></div><div className="editorial-finale-actions"><Link className="editorial-button editorial-button-lime" to={createUrl}>Покажи, что листаешь ↗</Link><Link className="editorial-text-link" to="/feeds">Просто посмотреть подборки →</Link></div></section>

    <footer className="editorial-footer"><div><strong>ПОЛИСТАЙ © 2026</strong><span>У каждого свой интернет.</span></div><nav aria-label="Ссылки в подвале"><Link to="/feeds">Подборки</Link><Link to="/tags">Темы</Link><Link to={authorUrl}>Для авторов</Link><a href="#faq">Вопросы и ответы</a><a href="mailto:neiromantra@ya.ru">Обратная связь</a><Link to="/privacy">Политика конфиденциальности</Link><Link to="/data-policy">Обработка персональных данных</Link></nav><small>Независимый проект. Не является официальным сервисом Telegram.</small></footer>
  </div>;
}
