// Отправка сообщений ботом прямо из браузера. api.telegram.org отдаёт CORS,
// поэтому работает без бэкенда. Токен хранится в localStorage (см. Settings).
// Для персонального однопользовательского приложения это приемлемо.

const TG_API = "https://api.telegram.org";
const MAX_LEN = 4096;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function splitMessage(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let cur = "";
  for (const block of text.split("\n\n")) {
    const cand = cur ? `${cur}\n\n${block}` : block;
    if (cand.length > max) {
      if (cur) parts.push(cur);
      if (block.length > max) {
        for (let i = 0; i < block.length; i += max) parts.push(block.slice(i, i + max));
        cur = "";
      } else cur = block;
    } else cur = cand;
  }
  if (cur) parts.push(cur);
  return parts;
}

export async function sendMessage(token: string, chatId: number, html: string): Promise<void> {
  if (!token) throw new Error("не задан токен бота (Настройки)");
  for (const part of splitMessage(html, MAX_LEN)) {
    const res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: part,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      }),
    });
    if (res.status === 429) {
      const d = (await res.json().catch(() => ({}))) as { parameters?: { retry_after?: number } };
      await new Promise((r) => setTimeout(r, (d.parameters?.retry_after ?? 1) * 1000));
      await sendMessage(token, chatId, part);
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Telegram: HTTP ${res.status} ${body}`);
    }
  }
}

export async function getLastChatId(token: string): Promise<number | null> {
  if (!token) throw new Error("не задан токен бота (Настройки)");
  const res = await fetch(`${TG_API}/bot${token}/getUpdates`);
  if (!res.ok) throw new Error(`Telegram: HTTP ${res.status}`);
  const data = (await res.json()) as {
    ok: boolean;
    result: Array<{ message?: { chat?: { id?: number } } }>;
  };
  if (!data.ok) return null;
  for (let i = data.result.length - 1; i >= 0; i--) {
    const id = data.result[i].message?.chat?.id;
    if (typeof id === "number") return id;
  }
  return null;
}
