/**
 * Server-only Telegram Bot API helpers (Route Handlers, Server Actions).
 * Client WebApp code lives in lib/telegram.ts.
 */

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Кнопки под сообщением (callback приходит в /api/telegram/webhook). */
export type InlineKeyboardButton = {
  text: string;
  callback_data?: string;
  url?: string;
  /** Открыть мини-приложение на этой странице (только в личке с ботом). */
  web_app?: { url: string };
};
export type InlineKeyboard = { inline_keyboard: InlineKeyboardButton[][] };

export type SendTelegramBotMessageOptions = {
  /** Telegram принимает и число, и строку; из БД bigint часто сериализуется как string. */
  chatId: number | string;
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
  disableWebPagePreview?: boolean;
  replyMarkup?: InlineKeyboard;
};

export type SendTelegramBotMessageResult =
  | { ok: true }
  | { ok: false; error: string };

const BOT_API_TIMEOUT_MS = 8000;

export type BotApiResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: string; code?: number };

/** POST в Bot API с результатом метода. Ошибки возвращаются, не бросаются. */
export async function callBotApiResult<T = unknown>(
  method: string,
  payload: Record<string, unknown>,
  timeoutMs = BOT_API_TIMEOUT_MS
): Promise<BotApiResult<T>> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN is not set" };
  }

  const url = `https://api.telegram.org/bot${token}/${method}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // Медленный Telegram не должен подвешивать отправку релиза и ответы API.
      signal: AbortSignal.timeout(timeoutMs)
    });

    const data = (await res.json()) as { ok?: boolean; description?: string; error_code?: number; result?: T };

    if (!data.ok) {
      return {
        ok: false,
        error: data.description ?? `Telegram API HTTP ${res.status}`,
        code: data.error_code ?? res.status
      };
    }

    return { ok: true, result: data.result as T };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

/** POST в Bot API. Requires TELEGRAM_BOT_TOKEN on the server. Ошибки возвращаются, не бросаются. */
async function callBotApi(
  method: string,
  payload: Record<string, unknown>,
  timeoutMs = BOT_API_TIMEOUT_MS
): Promise<SendTelegramBotMessageResult> {
  const r = await callBotApiResult(method, payload, timeoutMs);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/**
 * sendMessage via Telegram Bot API. Requires TELEGRAM_BOT_TOKEN on the server.
 */
export async function sendTelegramBotMessage(
  options: SendTelegramBotMessageOptions
): Promise<SendTelegramBotMessageResult> {
  return callBotApi("sendMessage", {
    chat_id: options.chatId,
    text: options.text,
    parse_mode: options.parseMode ?? "HTML",
    disable_web_page_preview: options.disableWebPagePreview ?? true,
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {})
  });
}

/** Заменить текст и кнопки уже отправленного сообщения (HTML). */
export async function editTelegramBotMessage(options: {
  chatId: number | string;
  messageId: number;
  text: string;
  replyMarkup?: InlineKeyboard;
}): Promise<SendTelegramBotMessageResult> {
  return callBotApi("editMessageText", {
    chat_id: options.chatId,
    message_id: options.messageId,
    text: options.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {})
  });
}

/** Ответ на нажатие кнопки: убирает «часики» и показывает короткий тост. */
export async function answerTelegramCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<SendTelegramBotMessageResult> {
  return callBotApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {})
  });
}

/**
 * sendDocument по ссылке: Telegram сам скачивает файл (до 20 МБ) и присылает его без сжатия.
 * Даём больше времени — Telegram отвечает только после загрузки файла.
 */
export async function sendTelegramBotDocumentByUrl(options: {
  chatId: number | string;
  documentUrl: string;
  caption?: string;
}): Promise<SendTelegramBotMessageResult> {
  return callBotApi(
    "sendDocument",
    {
      chat_id: options.chatId,
      document: options.documentUrl,
      ...(options.caption ? { caption: options.caption, parse_mode: "HTML" } : {})
    },
    30_000
  );
}
