export type Theme = "light" | "dark" | "bimbo" | "genshin" | "manga";
const KEY = "tf_theme";
const allowed: Theme[] = ["light", "dark", "bimbo", "genshin", "manga"];
export function getTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (allowed.includes(saved as Theme)) return saved as Theme;
  } catch {}
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const colors: Record<Theme, string> = { light: "#dedbcf", dark: "#17171c", bimbo: "#ffe1f3", genshin: "#f3e8ce", manga: "#f8f8f5" };
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", colors[theme]);
}
export function setTheme(theme: Theme): void {
  try { localStorage.setItem(KEY, theme); } catch {}
  applyTheme(theme);
}
