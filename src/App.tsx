import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth.tsx";
import { Loading } from "./components/States.tsx";
import Icon from "./components/Icon.tsx";
import PublicFeeds from "./pages/PublicFeeds.tsx";
import Landing from "./pages/Landing.tsx";
import PostView from "./pages/PostView.tsx";
import ChannelView from "./pages/ChannelView.tsx";
import TagStream from "./pages/TagStream.tsx";
import MyFeeds from "./pages/MyFeeds.tsx";
import FeedView from "./pages/FeedView.tsx";
import FeedEdit from "./pages/FeedEdit.tsx";
import Admin from "./pages/Admin.tsx";
import Login from "./pages/Login.tsx";
import Account from "./pages/Account.tsx";
import Privacy from "./pages/Privacy.tsx";
import DataPolicy from "./pages/DataPolicy.tsx";
import Tags from "./pages/Tags.tsx";
import Diag from "./pages/Diag.tsx";
import Favorites from "./pages/Favorites.tsx";
import MenuDrawer from "./components/MenuDrawer.tsx";
import type { ReactElement } from "react";

export default function App() {
  const { loading } = useAuth();
  if (loading) return <div className="app"><Loading /></div>;

  return (
    <div className="app">
      <MenuDrawer />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/feeds" element={<PublicFeeds />} />
        <Route path="/feed/:id" element={<FeedView />} />
        <Route path="/post/:channel/:msgId" element={<PostView />} />
        <Route path="/channel/:channel" element={<ChannelView />} />
        <Route path="/login" element={<Login />} />
        <Route path="/tags" element={<Tags />} />
        <Route path="/tag/:tag" element={<TagStream />} />
        <Route path="/diag" element={<Diag />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/data-policy" element={<DataPolicy />} />
        <Route path="/my" element={<RequireAuth><MyFeeds /></RequireAuth>} />
        <Route path="/my/new" element={<RequireAuth><FeedEdit /></RequireAuth>} />
        <Route path="/my/:id/edit" element={<RequireAuth><FeedEdit /></RequireAuth>} />
        <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
        <Route path="/favorites" element={<RequireAuth><Favorites /></RequireAuth>} />
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
      <NavLink to="/feeds"><Icon name="feed" size={16} /><span>Ленты</span></NavLink>
      <NavLink to="/favorites" className="tab-cloud" aria-label="Избранное">
        <Icon name="heart" size={18} />
      </NavLink>
      <NavLink to="/my"><Icon name="folder" size={16} /><span>Мои</span></NavLink>
    </nav>
  );
}
