import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth.tsx";
import { TopBar } from "../components/States.tsx";
import TgConnect from "../components/TgConnect.tsx";

export default function Account() {
  const { profile, signOut, isAdmin } = useAuth();
  const nav = useNavigate();

  async function logout() {
    await signOut();
    nav("/", { replace: true });
  }

  return (
    <>
      <TopBar title="Аккаунт" />
      <div className="content">
        <div className="card">
          <div className="row" style={{ gap: 12 }}>
            {profile?.photo_url && (
              <img
                src={profile.photo_url}
                alt=""
                width={56}
                height={56}
                style={{ borderRadius: 6 }}
              />
            )}
            <div>
              <div style={{ fontWeight: 600 }}>{profile?.display_name || "Пользователь"}</div>
              {profile?.username && <div className="muted">@{profile.username}</div>}
              <div className="muted">Роль: {isAdmin ? "администратор" : "пользователь"}</div>
            </div>
          </div>
        </div>
        {isAdmin && <TgConnect />}

        <button className="btn danger" onClick={logout}>
          Выйти
        </button>
      </div>
    </>
  );
}
