import { escapeHtml } from "@/lib/telegram-bot.server";
import { getExpectedAdminTelegramId } from "@/lib/admin";

/**
 * Куда уходит форма релиза: группа коллег (TELEGRAM_COLLEAGUES_CHAT_ID, бот должен быть в ней),
 * а если она не задана — личный чат админа с ботом, откуда форму пересылают дальше.
 */
export function colleaguesChatId(): string | null {
  const raw = process.env.TELEGRAM_COLLEAGUES_CHAT_ID?.trim() ?? "";
  if (/^-?\d+$/.test(raw)) return raw;
  try {
    return String(getExpectedAdminTelegramId());
  } catch {
    return null;
  }
}

/**
 * Сообщение в рабочий чат: шаблон «Форма релиза» как есть + ссылка на архив со всеми файлами.
 * Форма — моноширинным блоком, чтобы коллеги копировали её одним касанием.
 */
export function buildColleaguesMessage(params: { form: string; bundleUrl: string | null }): string {
  const parts = [`<pre>${escapeHtml(params.form)}</pre>`];
  if (params.bundleUrl) {
    parts.push(
      `📦 <a href="${escapeHtml(params.bundleUrl)}">Скачать архив</a> — обложка, WAV и тексты. Ссылка работает 7 дней.`
    );
  }
  return parts.join("\n\n");
}
