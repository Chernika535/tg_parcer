// Все домены, кроме основного, ведут на polistay.online (301). Так один основной
// домен: единый вход (в т.ч. Telegram-виджет) и сессия — без перелогинов.
const PRIMARY = "polistay.online";

export default defineEventHandler((event) => {
  const host = (getRequestHost(event) || "").toLowerCase();
  if (!host) return;
  // Не трогаем сам основной домен и локальную разработку.
  if (host === PRIMARY || host.startsWith("localhost") || host.startsWith("127.0.0.1")) return;
  const url = getRequestURL(event);
  return sendRedirect(event, `https://${PRIMARY}${url.pathname}${url.search}`, 301);
});
