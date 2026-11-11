/**
 * Методы Bot API 10.4 для интерактивных карточек (widgets).
 * Ошибки возвращаются, не бросаются — как и у остальных вызовов бота.
 */
import { callBotApiResult, type BotApiResult } from "@/lib/telegram-bot.server";

export type WidgetMessage = { message_id: number; chat: { id: number } };

/** Апдейт `widget_query`: запрос из карточки (W.request). */
export type WidgetQuery = {
  id: string;
  from?: { id?: number | string };
  chat?: { id?: number | string; type?: string };
  message_id?: number;
  chat_instance?: string;
  type?: string;
  data?: string;
  widget_id?: string;
};

/** Ответить на запрос карточки нужно за 15 с; берём таймаут с запасом. */
const QUERY_TIMEOUT_MS = 11_000;

export function sendWidget(params: {
  chatId: number | string;
  html: string;
  chatData: string;
  caption: string;
  disableNotification?: boolean;
}): Promise<BotApiResult<WidgetMessage>> {
  return callBotApiResult<WidgetMessage>("sendWidget", {
    chat_id: params.chatId,
    html: params.html,
    chat_data: params.chatData,
    caption: params.caption,
    allow_queries: true,
    disable_notification: params.disableNotification ?? false
  });
}

export function editMessageWidgetData(params: {
  chatId: number | string;
  messageId: number;
  chatData: string;
}): Promise<BotApiResult<unknown>> {
  return callBotApiResult("editMessageWidgetData", {
    chat_id: params.chatId,
    message_id: params.messageId,
    chat_data: params.chatData
  });
}

/** Подпись видна в списке чатов, уведомлениях и в Telegram Desktop вместо карточки. */
export function editWidgetCaption(params: {
  chatId: number | string;
  messageId: number;
  caption: string;
}): Promise<BotApiResult<unknown>> {
  return callBotApiResult("editMessageCaption", {
    chat_id: params.chatId,
    message_id: params.messageId,
    caption: params.caption
  });
}

export function answerWidgetQuery(widgetQueryId: string, data: string): Promise<BotApiResult<unknown>> {
  return callBotApiResult("answerWidgetQuery", { widget_query_id: widgetQueryId, data }, QUERY_TIMEOUT_MS);
}

export type BotCommand = { command: string; description: string };

export function setMyCommands(
  commands: BotCommand[],
  scope: { type: "all_private_chats" } | { type: "chat"; chat_id: number | string }
): Promise<BotApiResult<unknown>> {
  return callBotApiResult("setMyCommands", { commands, scope });
}

/** Сообщение удалено, бот заблокирован или чат недоступен — карточку больше не трогаем. */
export function isGoneError(error: string, code?: number): boolean {
  return code === 403 || /forbidden|message to edit not found|message not found|chat not found|bot was blocked/i.test(error);
}

export function isNotModifiedError(error: string): boolean {
  return /not modified/i.test(error);
}
