// Оффлайн-проверка парсинга на фикстуре, повторяющей разметку t.me/s.
import { parsePosts } from "../api/_lib/scraper.ts";

const html = `
<div class="tgme_widget_message_wrap">
  <div class="tgme_widget_message" data-post="durov/420">
    <div class="tgme_widget_message_text">Привет,<br>мир! Много   пробелов.</div>
    <div class="tgme_widget_message_photo"></div>
    <div class="tgme_widget_message_date"><time datetime="2026-06-20T10:00:00+00:00"></time></div>
  </div>
</div>
<div class="tgme_widget_message_wrap">
  <div class="tgme_widget_message" data-post="durov/421">
    <div class="tgme_widget_message_text">Второй пост без медиа</div>
    <div class="tgme_widget_message_date"><time datetime="2026-06-21T12:30:00+00:00"></time></div>
  </div>
</div>
<div class="tgme_widget_message" data-post="durov/broken">
  <div class="tgme_widget_message_text">битый id — должен быть пропущен</div>
</div>
`;

const posts = parsePosts(html, "durov");
console.log(JSON.stringify(posts, null, 2));

const ok =
  posts.length === 2 &&
  posts[0].msgId === 420 &&
  posts[0].hasMedia === true &&
  posts[0].text.includes("Привет") &&
  posts[0].text.includes("\n") &&
  posts[1].msgId === 421 &&
  posts[1].hasMedia === false &&
  posts[0].postedAt < posts[1].postedAt &&
  posts[1].link === "https://t.me/durov/421";

console.log(ok ? "PARSE OK" : "PARSE FAIL");
process.exit(ok ? 0 : 1);
