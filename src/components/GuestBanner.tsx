import { useState } from "react";
import { useNavigate } from "react-router-dom";

// Баннер для незарегистрированных: предлагает войти/зарегистрироваться (через
// Telegram или по почте). Закрывается — тогда гость смотрит публичные ленты без
// регистрации. Скрытие запоминается на сессию, чтобы не мозолил глаза.
const KEY = "tf_guest_banner_hidden";

export default function GuestBanner() {
  const nav = useNavigate();
  const [hidden, setHidden] = useState(() => {
    try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; }
  });
  if (hidden) return null;
  const close = () => {
    try { sessionStorage.setItem(KEY, "1"); } catch { /* ignore */ }
    setHidden(true);
  };
  return (
    <div className="card guest-banner">
      <div style={{ fontWeight: 800, fontSize: 16 }}>Зарегистрируйтесь или войдите</div>
      <p className="muted" style={{ fontSize: 14, margin: "6px 0 10px" }}>
        Сохраняйте посты и ленты в избранное, собирайте свои подборки и читайте закрытые каналы.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn" onClick={() => nav("/login")}>Через Telegram</button>
        <button className="btn secondary" onClick={() => nav("/login")}>По почте</button>
      </div>
      <button className="guest-banner-skip" onClick={close}>
        Закрыть и смотреть публичные ленты без регистрации
      </button>
    </div>
  );
}
