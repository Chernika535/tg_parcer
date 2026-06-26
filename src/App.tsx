import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth.tsx";
import { Loading } from "./components/States.tsx";
import PublicFeeds from "./pages/PublicFeeds.tsx";
import MyFeeds from "./pages/MyFeeds.tsx";
import FeedView from "./pages/FeedView.tsx";
import FeedEdit from "./pages/FeedEdit.tsx";
import Admin from "./pages/Admin.tsx";
import Login from "./pages/Login.tsx";
import Account from "./pages/Account.tsx";
import type { ReactElement } from "react";

export default function App() {
  const { loading } = useAuth();
  if (loading) return <div className="app"><Loading /></div>;

  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<PublicFeeds />} />
        <Route path="/feed/:id" element={<FeedView />} />
        <Route path="/login" element={<Login />} />
        <Route path="/my" element={<RequireAuth><MyFeeds /></RequireAuth>} />
        <Route path="/my/new" element={<RequireAuth><FeedEdit /></RequireAuth>} />
        <Route path="/my/:id/edit" element={<RequireAuth><FeedEdit /></RequireAuth>} />
        <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
        <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <TabBar />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactElement }) {
  const { session } = useAuth();
  return session ? children : <Navigate to="/login" replace />;
}

function RequireAdmin({ children }: { children: ReactElement }) {
  const { session, isAdmin } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  return isAdmin ? children : <Navigate to="/" replace />;
}

function TabBar() {
  const { session, isAdmin } = useAuth();
  return (
    <nav className="tabbar">
      <NavLink to="/" end>
        <span className="ico">🌐</span>Лента
      </NavLink>
      <NavLink to="/my">
        <span className="ico">📁</span>Мои
      </NavLink>
      {isAdmin && (
        <NavLink to="/admin">
          <span className="ico">🛡️</span>Модерация
        </NavLink>
      )}
      <NavLink to={session ? "/account" : "/login"}>
        <span className="ico">{session ? "👤" : "🔑"}</span>
        {session ? "Аккаунт" : "Вход"}
      </NavLink>
    </nav>
  );
}
