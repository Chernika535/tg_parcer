// Быстрая проверка скрапера на реальном публичном канале.
//   npm run test:scraper [channel]
import { fetchChannelPosts } from "../api/_lib/scraper.ts";

const channel = process.argv[2] || "telegram";

const posts = await fetchChannelPosts(channel);
console.log(`channel=${channel} posts=${posts.length}`);
if (posts.length === 0) {
  console.error("FAIL: пустой результат");
  process.exit(1);
}
const p = posts[posts.length - 1];
console.log("latest:", {
  msgId: p.msgId,
  postedAt: p.postedAt,
  hasMedia: p.hasMedia,
  link: p.link,
  text: p.text.slice(0, 120),
});
const ok = p.msgId > 0 && !!p.postedAt && p.link.includes(channel);
console.log(ok ? "OK" : "FAIL: некорректные поля");
process.exit(ok ? 0 : 1);
