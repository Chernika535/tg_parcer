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

// Ссылка на ленту в приложении (HashRouter).
export function feedUrl(id: number): string {
  return `${location.origin}/#/feed/${id}`;
}
