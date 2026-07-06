import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth.tsx";
import Icon, { type IconName } from "./Icon.tsx";
import { getTheme, setTheme, type Theme } from "../lib/theme.ts";

const AUTHOR_EMAIL = "neiromantra@ya.ru";
const ADD_CHANNEL_URL = "https://forms.yandex.ru/u/6a401bffe010db1391853844";

export default function MenuDrawer() {
  const [open, setOpen] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const { session, isAdmin, signOut } = useAuth();
  const nav = useNavigate();

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  }

  function go(to: string) {
    setOpen(false);
    nav(to);
  }

  return (
    <>
      <button className="burger" aria-label="Меню" onClick={() => setOpen(true)}>
        <Icon name="menu" />
      </button>

      {open && (
        <div className="drawer-overlay" onClick={() => setOpen(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <span className="drawer-brand">Полистай</span>
              <button className="burger ghost" onClick={() => setOpen(false)} aria-label="Закрыть">
                <Icon name="close" />
              </button>
            </div>

            <nav className="drawer-nav">
              <Item icon="feed" label="Главная" onClick={() => go("/")} />
              <Item icon="feed" label="Все ленты" onClick={() => go("/feeds")} />
              <Item icon="folder" label="Мои ленты" onClick={() => go("/my")} />
              <Item icon="cloud" label="Теги" onClick={() => go("/tags")} />
              <Item icon="feed" label="Блог / О нас" onClick={() => go("/channel/polistay_online")} />
              {session && <Item icon="star" label="Избранное" onClick={() => go("/favorites")} />}
              {session && <Item icon="plus" label="Кабинет автора" onClick={() => go("/author")} />}
              {isAdmin && <Item icon="shield" label="Модерация" onClick={() => go("/admin")} />}
              <Item
                icon={session ? "user" : "login"}
                label={session ? "Аккаунт" : "Вход"}
                onClick={() => go(session ? "/account" : "/login")}
              />
            </nav>

            <div className="drawer-sep" />
            <nav className="drawer-nav">
              <a className="drawer-item" href={ADD_CHANNEL_URL}><Icon name="plus" size={18} /><span>Добавить канал</span></a>
              <Item icon="plus" label="Добавить подборку" onClick={() => go(session ? "/my/new" : "/login")} />
              <Item icon="doc" label="Политика конфиденциальности" onClick={() => go("/privacy")} />
              <Item icon="doc" label="Обработка перс. данных" onClick={() => go("/data-policy")} />
              <a className="drawer-item" href={`mailto:${AUTHOR_EMAIL}`}><Icon name="mail" size={18} /><span>Связаться с автором</span></a>
            </nav>

            <div className="drawer-sep" />
            <button className="drawer-item" onClick={toggleTheme}>
              <span aria-hidden style={{ fontSize: 18, width: 18, textAlign: "center" }}>{theme === "dark" ? "☀️" : "🌙"}</span>
              <span>{theme === "dark" ? "Светлая тема" : "Тёмная тема"}</span>
            </button>

            {session && (
              <>
                <div className="drawer-sep" />
                <button
                  className="drawer-item danger"
                  onClick={async () => {
                    await signOut();
                    go("/");
                  }}
                >
                  <Icon name="logout" size={18} /><span>Выйти</span>
                </button>
              </>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

function Item({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button className="drawer-item" onClick={onClick}>
      <Icon name={icon} size={18} />
      <span>{label}</span>
    </button>
  );
}
