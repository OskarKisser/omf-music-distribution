import { escapeHtml } from "@/lib/telegram-bot.server";

/** Чат коллег, куда уходит форма релиза (бот должен быть добавлен в группу). */
export function colleaguesChatId(): string | null {
  const raw = process.env.TELEGRAM_COLLEAGUES_CHAT_ID?.trim() ?? "";
  return /^-?\d+$/.test(raw) ? raw : null;
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
