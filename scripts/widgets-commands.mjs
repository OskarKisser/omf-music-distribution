#!/usr/bin/env node
/**
 * Меню команд бота по ролям (setMyCommands).
 *
 *   node --env-file=.env.local scripts/widgets-commands.mjs          — меню админу (scope конкретного чата)
 *   node --env-file=.env.local scripts/widgets-commands.mjs --all    — плюс /releases всем в личке (при общей выкатке)
 *   node --env-file=.env.local scripts/widgets-commands.mjs --show   — показать, что сейчас стоит
 */
const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const adminId = (process.env.ADMIN_TELEGRAM_ID || process.env.NEXT_PUBLIC_ADMIN_TELEGRAM_ID || "").trim();
const args = new Set(process.argv.slice(2));
if (!token || !/^\d+$/.test(adminId)) {
  console.error("Нужны TELEGRAM_BOT_TOKEN и ADMIN_TELEGRAM_ID.");
  process.exit(2);
}

async function call(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {})
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description ?? res.status}`);
  return data.result;
}

const ARTIST = [{ command: "releases", description: "Мои релизы — живая карточка" }];
const ADMIN = [{ command: "today", description: "Пульт: очередь и оплаты" }, ...ARTIST];
const adminScope = { type: "chat", chat_id: adminId };
const privateScope = { type: "all_private_chats" };

if (args.has("--show")) {
  console.log("Админу:", await call("getMyCommands", { scope: adminScope }));
  console.log("Всем в личке:", await call("getMyCommands", { scope: privateScope }));
  process.exit(0);
}
await call("setMyCommands", { commands: ADMIN, scope: adminScope });
console.log("Меню админа:", ADMIN.map((c) => "/" + c.command).join(" "));
if (args.has("--all")) {
  await call("setMyCommands", { commands: ARTIST, scope: privateScope });
  console.log("Меню всем в личке:", ARTIST.map((c) => "/" + c.command).join(" "));
}
