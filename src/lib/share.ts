// Поделиться ссылкой: системное меню (если есть), иначе копируем в буфер.
export async function shareLink(url: string, title?: string): Promise<void> {
  const nav = navigator as Navigator & { share?: (d: { url: string; title?: string; text?: string }) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ url, title, text: title });
      return;
    } catch {
      return; // пользователь отменил — ничего не делаем
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    alert("Ссылка скопирована:\n" + url);
  } catch {
    prompt("Скопируйте ссылку:", url);
  }
}

// Ссылка на ленту. «Чистый» адрес /feed/:id (без #): сервер отдаёт по нему
// мета-теги ленты для превью в соцсетях/мессенджерах, а человека сразу
// перекидывает в SPA (#/feed/:id).
export function feedUrl(id: number): string {
  return `${location.origin}/feed/${id}`;
}
// Ссылка на страницу канала (сервер отдаёт превью, человека — в SPA).
export function channelUrl(channel: string): string {
  return `${location.origin}/channel/${channel}`;
}
// Ссылка на отдельный пост в приложении.
export function postUrl(channel: string, msgId: number, feedId?: number): string {
  const url = `${location.origin}/post/${encodeURIComponent(channel)}/${msgId}`;
  return feedId ? `${url}?feed=${feedId}` : url;
}

// Пользовательские ссылки «Открыть в Telegram». t.me бывает недоступен в браузере,
// поэтому наружу отдаём равнозначное зеркало telegram.me (приложение Telegram
// одинаково перехватывает оба домена). Идентификатор поста (post.link) НЕ трогаем.
export function tgUrl(path: string): string {
  return `https://telegram.me/${path}`;
}
export function tgMirror(link: string): string {
  return (link || "").replace(/^https?:\/\/(?:t\.me|telegram\.me|telegram\.dog)\//i, "https://telegram.me/");
}
