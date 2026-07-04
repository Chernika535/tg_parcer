// Тема оформления: светлая / тёмная. Храним выбор в localStorage; если выбора
// нет — берём системную настройку. Применяется через data-theme на <html>.
export type Theme = "light" | "dark";

const KEY = "tf_theme";

export function getTheme(): Theme {
  try {
    const s = localStorage.getItem(KEY);
    if (s === "dark" || s === "light") return s;
  } catch { /* приватный режим */ }
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "dark" ? "#17171c" : "#dedbcf");
}

export function setTheme(t: Theme): void {
  try { localStorage.setItem(KEY, t); } catch { /* игнор */ }
  applyTheme(t);
}
