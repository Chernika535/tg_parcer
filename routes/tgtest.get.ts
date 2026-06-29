// Тест: может ли САМ сервер Onreza достучаться до Telegram (t.me и CDN картинок).
// Если да — парсинг и картинки можно делать прямо здесь, без хопа через Supabase.
export default defineEventHandler(async () => {
  const result: Record<string, unknown> = {};

  async function probe(name: string, url: string) {
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch(url, {
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "user-agent": "Mozilla/5.0 (compatible; FeedAggregator/1.0)" },
      }).finally(() => clearTimeout(timer));
      const buf = new Uint8Array(await r.arrayBuffer());
      result[name] = {
        ok: r.ok,
        status: r.status,
        type: r.headers.get("content-type"),
        bytes: buf.length,
        ms: Date.now() - t0,
      };
      return buf;
    } catch (e) {
      result[name] = { ok: false, error: (e as Error).message, ms: Date.now() - t0 };
      return null;
    }
  }

  // 1) Страница канала (HTML-скрейп).
  const html = await probe("t.me/s/durov", "https://t.me/s/durov");

  // 2) Картинка из этой же страницы (Telegram CDN).
  let imgUrl: string | undefined;
  if (html) {
    const text = new TextDecoder().decode(html);
    imgUrl = text.match(/background-image\s*:\s*url\(['"]?(https:\/\/[^'")]+)['"]?\)/i)?.[1]
      ?? text.match(/<img[^>]+src="(https:\/\/cdn[^"]+)"/i)?.[1];
  }
  result["найденный_url_картинки"] = imgUrl ?? "не найден в HTML";
  if (imgUrl) await probe("картинка с CDN", imgUrl.replace(/&amp;/g, "&"));

  return result;
});
