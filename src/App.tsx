import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth.tsx";
import { Loading } from "./components/States.tsx";
import Icon from "./components/Icon.tsx";
import PublicFeeds from "./pages/PublicFeeds.tsx";
import MyFeeds from "./pages/MyFeeds.tsx";
import FeedView from "./pages/FeedView.tsx";
import FeedEdit from "./pages/FeedEdit.tsx";
import Admin from "./pages/Admin.tsx";
import Login from "./pages/Login.tsx";
import Account from "./pages/Account.tsx";
import Privacy from "./pages/Privacy.tsx";
import DataPolicy from "./pages/DataPolicy.tsx";
import Tags from "./pages/Tags.tsx";
import MenuDrawer from "./components/MenuDrawer.tsx";
import type { ReactElement } from "react";

export default function App() {
  const { loading } = useAuth();
  if (loading) return <div className="app"><Loading /></div>;

  return (
    <div className="app">
      <MenuDrawer />
      <Routes>
        <Route path="/" element={<PublicFeeds />} />
        <Route path="/feed/:id" element={<FeedView />} />
        <Route path="/login" element={<Login />} />
        <Route path="/tags" element={<Tags />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/data-policy" element={<DataPolicy />} />
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
  return (
    <nav className="tabbar">
      <NavLink to="/" end><Icon name="feed" /><span>Лента</span></NavLink>
      <NavLink to="/tags" className="tab-cloud" aria-label="Теги">
        <Icon name="cloud" size={24} />
      </NavLink>
      <NavLink to="/my"><Icon name="folder" /><span>Мои</span></NavLink>
    </nav>
  );
}
