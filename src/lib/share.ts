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
export function postUrl(channel: string, msgId: number): string {
  return `${location.origin}/#/post/${channel}/${msgId}`;
}
