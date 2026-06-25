// Только отправка сообщений ботом. Чтение каналов делает scraper, не бот.
const TG_API = "https://api.telegram.org";
const MAX_LEN = 4096;

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN не задан");
  return t;
}

/**
 * Отправляет HTML-сообщение. Длинный текст режет на части по границам строк
 * (разделитель блоков постов — двойной перенос), обрабатывает 429 retry_after.
 */
export async function sendMessage(chatId: number, htmlText: string): Promise<void> {
  const parts = splitMessage(htmlText, MAX_LEN);
  for (const part of parts) {
    await sendOne(chatId, part);
  }
}

async function sendOne(chatId: number, text: string, retried = false): Promise<void> {
  const res = await fetch(`${TG_API}/bot${token()}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });

  if (res.status === 429 && !retried) {
    const data = (await res.json().catch(() => ({}))) as { parameters?: { retry_after?: number } };
    const wait = (data.parameters?.retry_after ?? 1) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return sendOne(chatId, text, true);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`sendMessage failed: HTTP ${res.status} ${body}`);
  }
}

function splitMessage(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  const blocks = text.split("\n\n");
  let cur = "";
  for (const block of blocks) {
    const candidate = cur ? `${cur}\n\n${block}` : block;
    if (candidate.length > max) {
      if (cur) parts.push(cur);
      // одиночный блок длиннее лимита — режем грубо
      if (block.length > max) {
        for (let i = 0; i < block.length; i += max) parts.push(block.slice(i, i + max));
        cur = "";
      } else {
        cur = block;
      }
    } else {
      cur = candidate;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** getUpdates для определения chat_id пользователя после /start. */
export async function getLastChatId(): Promise<number | null> {
  const res = await fetch(`${TG_API}/bot${token()}/getUpdates`);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    ok: boolean;
    result: Array<{ message?: { chat?: { id?: number } } }>;
  };
  if (!data.ok || !Array.isArray(data.result)) return null;
  for (let i = data.result.length - 1; i >= 0; i--) {
    const id = data.result[i].message?.chat?.id;
    if (typeof id === "number") return id;
  }
  return null;
}
