/**
 * Уведомления админу в Telegram (новый релиз на модерации, ошибки).
 * Ошибки наружу не пробрасываются: уведомление не должно ломать основной сценарий.
 */

import { getExpectedAdminTelegramId } from "@/lib/admin";
import { escapeHtml, sendTelegramBotMessage, type InlineKeyboard } from "@/lib/telegram-bot.server";
import { sendTelegramNotification } from "@/lib/telegram-notifications";

let lastErrorNoticeAt = 0;
const ERROR_NOTICE_COOLDOWN_MS = 2 * 60 * 1000;

async function sendToAdmin(text: string): Promise<void> {
  try {
    await sendTelegramNotification(String(getExpectedAdminTelegramId()), text);
  } catch (e) {
    console.error("[admin-notify]", e);
  }
}

/** Ссылка на релиз в админке мини-приложения; null — адрес приложения неизвестен или не https. */
export function adminReleaseWebAppUrl(appOrigin: string | null | undefined, releaseId: string): string | null {
  const origin = (appOrigin ?? "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+$/.test(origin) || !releaseId) return null;
  return `${origin}/admin/release/${encodeURIComponent(releaseId)}`;
}

export async function notifyAdminReleaseSubmitted(params: {
  releaseId: string;
  title: string;
  artist: string;
  telegramId?: string | number | null;
  /** Origin мини-приложения (из запроса артиста) — для кнопки «Открыть релиз». */
  appOrigin?: string | null;
}): Promise<void> {
  const who = params.telegramId ? ` (tg ${escapeHtml(String(params.telegramId))})` : "";
  const text =
    `🆕 <b>Новый релиз на модерации</b>\n\n` +
    `«${escapeHtml(params.title || "без названия")}» — ${escapeHtml(params.artist || "—")}${who}`;
  await sendToAdminWithReleaseButton(text, params.releaseId, params.appOrigin);
}

/** Артист попросил снять релиз с площадок — модератору снять и подтвердить в админке. */
export async function notifyAdminTakedownRequested(params: {
  releaseId: string;
  title: string;
  artist: string;
  telegramId?: string | number | null;
  reason?: string | null;
  appOrigin?: string | null;
}): Promise<void> {
  const who = params.telegramId ? ` (tg ${escapeHtml(String(params.telegramId))})` : "";
  const reason = params.reason?.trim() ? `\n\nПричина: ${escapeHtml(params.reason.trim())}` : "";
  const text =
    `🗑 <b>Артист просит удалить релиз с площадок</b>\n\n` +
    `«${escapeHtml(params.title || "без названия")}» — ${escapeHtml(params.artist || "—")}${who}${reason}\n\n` +
    `Сними релиз у дистрибьютора и нажми «Релиз снят с площадок» в админке.`;
  await sendToAdminWithReleaseButton(text, params.releaseId, params.appOrigin);
}

/** Артист заполнил или поправил питчинг — забрать текст и фото для редакций. */
export async function notifyAdminPressKitSaved(params: {
  releaseId: string;
  kind: "filled" | "updated";
  title: string;
  artist: string;
  telegramId?: string | number | null;
  pressText: string | null;
  hasPhoto: boolean;
  appOrigin?: string | null;
}): Promise<void> {
  const who = params.telegramId ? ` (tg ${escapeHtml(String(params.telegramId))})` : "";
  const head = params.kind === "filled" ? "📣 <b>Артист заполнил питчинг</b>" : "✏️ <b>Артист обновил питчинг</b>";
  const body = params.pressText?.trim() ? `\n\n<i>${escapeHtml(params.pressText.trim())}</i>` : "\n\nТекста нет.";
  const text =
    `${head}\n\n` +
    `«${escapeHtml(params.title || "без названия")}» — ${escapeHtml(params.artist || "—")}${who}` +
    body +
    `\n\nФото: ${params.hasPhoto ? "есть" : "нет"}`;
  await sendToAdminWithReleaseButton(text, params.releaseId, params.appOrigin);
}

/** Сообщение админу с кнопкой «Открыть релиз» (мини-приложение); без адреса — просто текст. */
async function sendToAdminWithReleaseButton(
  text: string,
  releaseId: string,
  appOrigin?: string | null
): Promise<void> {
  const fallback = `${text}\n\nОткрой админку в мини-приложении.`;
  const releaseUrl = adminReleaseWebAppUrl(appOrigin, releaseId);
  if (!releaseUrl) {
    await sendToAdmin(fallback);
    return;
  }
  const replyMarkup: InlineKeyboard = {
    inline_keyboard: [[{ text: "Открыть релиз", web_app: { url: releaseUrl } }]]
  };
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) return;
    const result = await sendTelegramBotMessage({
      chatId: String(getExpectedAdminTelegramId()),
      text,
      replyMarkup
    });
    // Кнопку не приняли (например, адрес не открывается как мини-приложение) — шлём без неё.
    if (!result.ok) {
      console.error("[admin-notify] with button:", result.error);
      await sendToAdmin(fallback);
    }
  } catch (e) {
    console.error("[admin-notify]", e);
  }
}

/** Друг по приглашению оплатил первый релиз — админу выплатить бонус пригласившему (кнопка «Выплатил»). */
export async function notifyAdminReferralPayout(params: {
  refereeTelegramId: string;
  /** Уже готовый HTML (ник или ссылка на профиль): экранирование — на стороне вызывающего. */
  referrerLabelHtml: string;
  refereeLabelHtml: string;
  amountRub: number;
}): Promise<void> {
  const text =
    `🎁 <b>Выплати ${escapeHtml(params.amountRub.toLocaleString("ru-RU"))} ₽ за приглашение</b>\n\n` +
    `Кому: ${params.referrerLabelHtml}\n` +
    `За друга: ${params.refereeLabelHtml} — оплатил первый релиз`;
  const replyMarkup: InlineKeyboard = {
    inline_keyboard: [[{ text: "✅ Выплатил", callback_data: `ref:out:${params.refereeTelegramId}` }]]
  };
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) return;
    const result = await sendTelegramBotMessage({
      chatId: String(getExpectedAdminTelegramId()),
      text,
      replyMarkup
    });
    if (!result.ok) console.error("[admin-notify] referral payout:", result.error);
  } catch (e) {
    console.error("[admin-notify] referral payout:", e);
  }
}

/** Не чаще одного сообщения об ошибке в 2 минуты (защита от спама и циклов ошибок). */
export async function notifyAdminError(where: string, message: string): Promise<void> {
  const now = Date.now();
  if (now - lastErrorNoticeAt < ERROR_NOTICE_COOLDOWN_MS) return;
  lastErrorNoticeAt = now;
  await sendToAdmin(
    `⚠️ <b>Ошибка в приложении</b>\n\n<b>${escapeHtml(where.slice(0, 120))}</b>\n${escapeHtml(message.slice(0, 500))}`
  );
}
