import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth.tsx";
import { TopBar } from "../components/States.tsx";
import TgConnect from "../components/TgConnect.tsx";
import TelegramLogin from "../components/TelegramLogin.tsx";
import { updateMyProfile, uploadAvatar } from "../lib/data.ts";
import type { TelegramUser } from "../lib/auth.tsx";

export default function Account() {
  const { profile, session, signOut, isAdmin, updateCredentials, refreshProfile, linkTelegram } = useAuth();
  const nav = useNavigate();
  const [tgMsg, setTgMsg] = useState("");

  async function onLinkTelegram(u: TelegramUser) {
    setTgMsg("Привязываю…");
    try { await linkTelegram(u); setTgMsg("Telegram привязан ✓ Теперь можно входить и через него."); }
    catch (e) { setTgMsg("Ошибка: " + (e as Error).message); }
  }

  const [name, setName] = useState(profile?.display_name || "");
  const [photo, setPhoto] = useState(profile?.photo_url || "");
  const [birth, setBirth] = useState(profile?.birth_date || "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");

  // Технический telegram.local в поле не показываем — он мешает вписать настоящий.
  const currentEmail = session?.user?.email || "";
  const realEmail = currentEmail.endsWith("@telegram.local") ? "" : currentEmail;
  const [email, setEmail] = useState(realEmail);
  const [password, setPassword] = useState("");
  const [savingCreds, setSavingCreds] = useState(false);
  const [credMsg, setCredMsg] = useState("");

  async function logout() {
    await signOut();
    nav("/", { replace: true });
  }

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSavingProfile(true);
    setProfileMsg("");
    try {
      setPhoto(await uploadAvatar(file));
    } catch (e) {
      setProfileMsg("Не удалось загрузить фото: " + (e as Error).message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveProfile() {
    setSavingProfile(true);
    setProfileMsg("");
    try {
      await updateMyProfile({ display_name: name.trim(), photo_url: photo || "", birth_date: birth || null });
      await refreshProfile();
      setProfileMsg("Сохранено ✓");
    } catch (e) {
      setProfileMsg("Ошибка: " + (e as Error).message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveCreds() {
    setCredMsg("");
    if (!email.trim() && !password) {
      setCredMsg("Укажите новый e-mail и/или пароль");
      return;
    }
    if (password && password.length < 6) {
      setCredMsg("Пароль не короче 6 символов");
      return;
    }
    setSavingCreds(true);
    try {
      const changeEmail = email.trim() && email.trim() !== (session?.user?.email || "");
      const { emailConfirm } = await updateCredentials({
        email: changeEmail ? email.trim() : undefined,
        password: password || undefined,
      });
      setPassword("");
      setCredMsg(emailConfirm ? "Готово. Подтвердите новый e-mail по ссылке из письма." : "Сохранено ✓ Теперь можно входить по e-mail и паролю.");
    } catch (e) {
      setCredMsg("Ошибка: " + (e as Error).message);
    } finally {
      setSavingCreds(false);
    }
  }

  return (
    <>
      <TopBar title="Личный кабинет" />
      <div className="content">
        {/* Профиль */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Профиль</h3>
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            {photo ? (
              <img src={photo} alt="" width={56} height={56} style={{ borderRadius: "50%", objectFit: "cover", border: "2px solid var(--ink)" }} />
            ) : (
              <div className="ava ava-ph" style={{ width: 56, height: 56 }}>@</div>
            )}
            <label className="btn secondary sm" style={{ cursor: "pointer" }}>
              {savingProfile ? "…" : "Загрузить фото"}
              <input type="file" accept="image/*" hidden onChange={onPickAvatar} disabled={savingProfile} />
            </label>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Имя</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Как вас показывать" />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Дата рождения</label>
            <input type="date" value={birth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBirth(e.target.value)} />
            <p className="muted" style={{ fontSize: 12 }}>
              Нужна только для лент 18+: если вам есть 18, подтверждать возраст каждый раз не придётся. Мы её нигде не показываем.
            </p>
          </div>
          {profile?.username && <p className="muted">Telegram: @{profile.username}</p>}
          <div className="muted">Роль: {isAdmin ? "администратор" : "пользователь"}</div>
          <button className="btn" style={{ marginTop: 10 }} onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? "Сохранение…" : "Сохранить профиль"}
          </button>
          {profileMsg && <p className="muted" style={{ marginTop: 8 }}>{profileMsg}</p>}
        </div>

        {/* E-mail и пароль */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>E-mail и пароль</h3>
          <p className="muted">
            Привяжите e-mail и пароль — чтобы входить без Telegram (например, без VPN).
            {realEmail ? ` Текущий e-mail: ${realEmail}.` : " Сейчас e-mail не привязан."}
          </p>
          <div className="field">
            <label>E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </div>
          <div className="field">
            <label>Новый пароль</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="не короче 6 символов" autoComplete="new-password" />
          </div>
          <button className="btn" onClick={saveCreds} disabled={savingCreds}>
            {savingCreds ? "Сохранение…" : "Сохранить e-mail / пароль"}
          </button>
          {credMsg && <p className="muted" style={{ marginTop: 8 }}>{credMsg}</p>}
        </div>

        {/* Привязка Telegram — чтобы входить и через него (актуально для тех, кто регистрировался по e-mail) */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Вход через Telegram</h3>
          {profile?.telegram_id ? (
            <p className="muted">
              Telegram привязан{profile.username ? `: @${profile.username}` : ""}. Можно входить и по e-mail, и через Telegram.
            </p>
          ) : (
            <>
              <p className="muted">
                Привяжите Telegram, чтобы входить в этот же аккаунт ещё и через него.
                Если виджет не появился (бывает без VPN) — вход по e-mail всё равно работает.
              </p>
              <TelegramLogin onAuth={onLinkTelegram} />
            </>
          )}
          {tgMsg && <p className="muted" style={{ marginTop: 8 }}>{tgMsg}</p>}
        </div>

        {isAdmin && <TgConnect />}

        <button className="btn danger" onClick={logout}>Выйти</button>
      </div>
    </>
  );
}
