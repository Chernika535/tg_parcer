// Локальный вход в Telegram-аккаунт для чтения каналов (запускать на компьютере).
// Требуется установленный Deno (https://deno.com).
//
// Запуск в папке репозитория:
//   deno run -A scripts/tg-login.ts
//
// Скрипт интерактивно спросит номер, код из Telegram и (если есть) облачный пароль,
// затем напечатает СТРОКУ СЕССИИ — её нужно вставить в приложении:
//   Аккаунт → «Чтение каналов без превью» → поле «Вставить строку сессии».
//
// Используется отдельный (запасной) аккаунт — риск блокировки.
import { Client, StorageMemory } from "https://deno.land/x/mtkruto/mod.ts";

const API_ID = 2040;
const API_HASH = "b18441a1ff607e10a989891a5462e627";

const client = new Client({ storage: new StorageMemory(), apiId: API_ID, apiHash: API_HASH });

await client.start({
  phone: () => prompt("Номер телефона (с +, напр. +79991234567): ")!.trim(),
  code: () => prompt("Код из Telegram: ")!.trim(),
  password: () => (prompt("Облачный пароль 2FA (если нет — просто Enter): ") ?? "").trim(),
});

const session = await client.exportAuthString();
console.log("\n================= СТРОКА СЕССИИ (скопируйте целиком) =================\n");
console.log(session);
console.log("\n=====================================================================\n");
console.log("Вставьте её в приложении: Аккаунт → Чтение каналов без превью → «Вставить строку сессии».");
await client.disconnect();
Deno.exit(0);
