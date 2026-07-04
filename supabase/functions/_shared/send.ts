// Общая логика отправки поста в Telegram-канал через Bot API. Медиа отправляем
// БАЙТАМИ (multipart), а не ссылкой: так надёжнее (Telegram не качает URL сам —
// иначе ловим WEBPAGE_MEDIA_EMPTY), и ссылки на хранилище нормализуем на прямой
// адрес Supabase (минуя прокси Onreza).
export type Media = {
  type: "photo" | "video" | "voice" | "audio" | "document";
  url: string; name?: string; title?: string; performer?: string;
};

export function makeSender(botToken: string, supabaseUrl: string) {
  const API = `https://api.telegram.org/bot${botToken}`;
  const base = supabaseUrl.replace(/\/$/, "");

  // Любую ссылку на storage приводим к прямому адресу Supabase.
  function direct(url: string): string {
    const i = url.indexOf("/storage/v1/");
    return i >= 0 ? base + url.slice(i) : url;
  }

  async function tg(method: string, body: Record<string, unknown>) {
    const r = await fetch(`${API}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return await r.json() as { ok: boolean; description?: string };
  }

  async function fetchMedia(url: string) {
    const r = await fetch(direct(url));
    if (!r.ok) throw new Error(`не удалось скачать вложение (${r.status})`);
    const type = r.headers.get("content-type") || "application/octet-stream";
    const bytes = new Uint8Array(await r.arrayBuffer());
    const name = (url.split("/").pop() || "file").split("?")[0];
    return { bytes, type, name };
  }

  // Отправка multipart: строковые поля + файлы (attach://<field>).
  async function tgForm(method: string, fields: Record<string, string | undefined>, files: { field: string; url: string; filename?: string }[]) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, v);
    for (const f of files) {
      const m = await fetchMedia(f.url);
      fd.append(f.field, new Blob([m.bytes], { type: m.type }), f.filename || m.name);
    }
    const r = await fetch(`${API}/${method}`, { method: "POST", body: fd });
    return await r.json() as { ok: boolean; description?: string };
  }

  return async function sendPost(
    chatId: string, text: string, parseMode: string | null, media: Media[], disablePreview: boolean,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const pm = parseMode || undefined;
      if (!media.length) {
        const r = await tg("sendMessage", {
          chat_id: chatId, text: text || " ", parse_mode: pm,
          link_preview_options: disablePreview ? { is_disabled: true } : undefined,
        });
        return r.ok ? { ok: true } : { ok: false, error: r.description };
      }

      const visuals = media.filter((m) => m.type === "photo" || m.type === "video").slice(0, 10);
      const singles = media.filter((m) => m.type === "voice" || m.type === "audio" || m.type === "document");
      let used = false;
      const cap = () => (!used && text ? ((used = true), text) : undefined);
      let firstErr = "";
      const fail = (d?: string) => { if (!firstErr && d) firstErr = d; };

      // Фото/видео — альбомом (или одиночно), байтами.
      if (visuals.length === 1) {
        const m = visuals[0];
        const c = cap();
        const method = m.type === "photo" ? "sendPhoto" : "sendVideo";
        const r = await tgForm(method, { chat_id: chatId, caption: c, parse_mode: c ? pm : undefined }, [{ field: m.type, url: m.url }]);
        if (!r.ok) fail(r.description);
      } else if (visuals.length > 1) {
        const c = cap();
        const arr = visuals.map((m, i) => ({
          type: m.type, media: `attach://f${i}`,
          caption: i === 0 && c ? c : undefined, parse_mode: i === 0 && c ? pm : undefined,
        }));
        const r = await tgForm("sendMediaGroup", { chat_id: chatId, media: JSON.stringify(arr) },
          visuals.map((m, i) => ({ field: `f${i}`, url: m.url })));
        if (!r.ok) fail(r.description);
      }

      // Голос/аудио/файлы — по одному, байтами. У голоса подпись поддерживается.
      for (const m of singles) {
        const c = cap();
        if (m.type === "voice") {
          const r = await tgForm("sendVoice", { chat_id: chatId, caption: c, parse_mode: c ? pm : undefined }, [{ field: "voice", url: m.url, filename: "voice.ogg" }]);
          if (!r.ok) fail(r.description);
        } else if (m.type === "audio") {
          const r = await tgForm("sendAudio", { chat_id: chatId, title: m.title, performer: m.performer, caption: c, parse_mode: c ? pm : undefined }, [{ field: "audio", url: m.url, filename: (m.title || "audio") + ".mp3" }]);
          if (!r.ok) fail(r.description);
        } else {
          const r = await tgForm("sendDocument", { chat_id: chatId, caption: c, parse_mode: c ? pm : undefined }, [{ field: "document", url: m.url, filename: m.name }]);
          if (!r.ok) fail(r.description);
        }
      }

      if (text && !used) {
        const r = await tg("sendMessage", { chat_id: chatId, text, parse_mode: pm });
        if (!r.ok) fail(r.description);
      }
      return firstErr ? { ok: false, error: firstErr } : { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  };
}
