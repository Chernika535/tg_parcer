// Применяет db/schema.sql идемпотентно. Запускать при деплое (build hook) или вручную:
//   npm run migrate
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sql } from "../api/_lib/db.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");
  console.log("[migrate] applying schema.sql ...");
  await sql.unsafe(schema);
  console.log("[migrate] done");
  await sql.end();
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
