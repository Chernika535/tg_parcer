import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import FeedsList from "./pages/FeedsList.tsx";
import FeedView from "./pages/FeedView.tsx";
import DigestsList from "./pages/DigestsList.tsx";
import DigestEdit from "./pages/DigestEdit.tsx";
import Settings from "./pages/Settings.tsx";

export default function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Navigate to="/feeds" replace />} />
        <Route path="/feeds" element={<FeedsList />} />
        <Route path="/feeds/:id" element={<FeedView />} />
        <Route path="/digests" element={<DigestsList />} />
        <Route path="/digests/new" element={<DigestEdit />} />
        <Route path="/digests/:id" element={<DigestEdit />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/feeds" replace />} />
      </Routes>
      <TabBar />
    </div>
  );
}

function TabBar() {
  return (
    <nav className="tabbar">
      <NavLink to="/feeds">
        <span className="ico">📰</span>Ленты
      </NavLink>
      <NavLink to="/digests">
        <span className="ico">🔎</span>Парсинги
      </NavLink>
      <NavLink to="/settings">
        <span className="ico">⚙️</span>Настройки
      </NavLink>
    </nav>
  );
}
