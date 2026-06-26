import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth.tsx";
import Icon, { type IconName } from "./Icon.tsx";

const AUTHOR_EMAIL = "author@example.com"; // TODO: реальный e-mail
const ADD_CHANNEL_URL = "#"; // TODO: анкета «добавить канал»
const ADD_FEED_URL = "#"; // TODO: анкета «добавить подборку»

export default function MenuDrawer() {
  const [open, setOpen] = useState(false);
  const { session, isAdmin, signOut } = useAuth();
  const nav = useNavigate();

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
              <span className="drawer-brand">ТелеФид</span>
              <button className="burger ghost" onClick={() => setOpen(false)} aria-label="Закрыть">
                <Icon name="close" />
              </button>
            </div>

            <nav className="drawer-nav">
              <Item icon="feed" label="Лента" onClick={() => go("/")} />
              <Item icon="folder" label="Мои ленты" onClick={() => go("/my")} />
              <Item icon="cloud" label="Теги" onClick={() => go("/tags")} />
              {session && <Item icon="heart" label="Избранное" onClick={() => go("/favorites")} />}
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
              <a className="drawer-item" href={ADD_FEED_URL}><Icon name="plus" size={18} /><span>Добавить подборку</span></a>
              <Item icon="doc" label="Политика конфиденциальности" onClick={() => go("/privacy")} />
              <Item icon="doc" label="Обработка перс. данных" onClick={() => go("/data-policy")} />
              <a className="drawer-item" href={`mailto:${AUTHOR_EMAIL}`}><Icon name="mail" size={18} /><span>Связаться с автором</span></a>
            </nav>

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
