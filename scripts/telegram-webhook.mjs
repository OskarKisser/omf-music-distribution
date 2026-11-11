#!/usr/bin/env node
/**
 * Подключает бота к /api/telegram/webhook: кнопки «Оплатил / Не оплатил / Не мой клиент»,
 * команды /releases и /today, запросы из карточек (widget_query).
 *
 *   node --env-file=.env.local scripts/telegram-webhook.mjs          — показать, куда сейчас смотрит бот
 *   node --env-file=.env.local scripts/telegram-webhook.mjs --set    — подключить наш вебхук
 *
 * Нужны TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET и NEXT_PUBLIC_APP_URL (или WEBHOOK_BASE_URL).
 * Если у бота уже стоит чужой вебхук или его кто-то опрашивает (getUpdates), --set откажется:
 * подключение заменило бы ту интеграцию. Тогда добавь --force, если уверен.
 */

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const base = (process.env.WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
const args = new Set(process.argv.slice(2));

if (!token) {
  console.error("Задай TELEGRAM_BOT_TOKEN.");
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

const info = await call("getWebhookInfo");
console.log("Сейчас:", info.url ? info.url : "вебхук не задан");
if (info.last_error_message) console.log("Последняя ошибка доставки:", info.last_error_message);
if (info.pending_update_count) console.log("В очереди обновлений:", info.pending_update_count);

if (!args.has("--set")) process.exit(0);

if (!secret || !/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
  console.error("TELEGRAM_WEBHOOK_SECRET: 16–256 символов, только A-Z, a-z, 0-9, _ и -.");
  process.exit(2);
}
if (!base.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL (или WEBHOOK_BASE_URL) должен быть https-адресом приложения.");
  process.exit(2);
}

const target = `${base}/api/telegram/webhook`;
if (info.url && info.url !== target && !args.has("--force")) {
  console.error(`У бота уже стоит другой вебхук (${info.url}). Чтобы заменить, запусти с --force.`);
  process.exit(1);
}

await call("setWebhook", {
  url: target,
  secret_token: secret,
  // widget_query надо перечислить явно: без него Telegram не присылает запросы из карточек.
  allowed_updates: ["callback_query", "message", "widget_query"]
});
console.log("Готово, бот шлёт кнопки, команды и запросы карточек на", target);
