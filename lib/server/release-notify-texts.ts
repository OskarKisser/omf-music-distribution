import { escapeHtml } from "@/lib/telegram-bot.server";
import { DSP_REVIEW_DAYS_TEXT } from "@/lib/release-next-step";
import { formatReleaseDateDayMonthRu } from "@/lib/admin-release-publish";

function safeTitle(title: string): string {
  const t = title.trim();
  return escapeHtml(t.length > 0 ? t : "релиз");
}

/** Модератор принял релиз и отправил дистрибьюторам; ссылки ещё нет. */
export function acceptedMessage(title: string): string {
  return (
    `✅ <b>Релиз «${safeTitle(title)}» принят!</b>\n\n` +
    `Мы отправили его на площадки. Их модерация обычно занимает ${DSP_REVIEW_DAYS_TEXT} — ` +
    `когда пройдёт, пришлём сюда ссылку на пресейв.`
  );
}

/** Ссылка на пресейв готова (сразу при приёме или позже, после модерации площадок). */
export function linkReadyMessage(
  title: string,
  link: string,
  opts: { acceptedNow: boolean; releaseDate?: string | null }
): string {
  const head = opts.acceptedNow
    ? `✅ <b>Релиз «${safeTitle(title)}» принят и уже прошёл модерацию площадок.</b>`
    : `🔗 <b>Релиз «${safeTitle(title)}» прошёл модерацию площадок.</b>`;
  // Дату пишем прямо в сообщении: артист сверяет её здесь, а не в анкете, где она могла устареть.
  const date = formatReleaseDateDayMonthRu(opts.releaseDate);
  const dateLine = date ? `Дата выхода: <b>${date}</b>\n` : "";
  return `${head}\n\n${dateLine}Ссылка на пресейв: <a href="${escapeHtml(link)}">открыть</a>`;
}

/** Модератор перенёс дату выхода (по просьбе артиста или по ответу площадок). */
export function releaseDateChangedMessage(title: string, releaseDate: string): string {
  const date = formatReleaseDateDayMonthRu(releaseDate) ?? escapeHtml(releaseDate);
  return `📅 <b>Дата выхода «${safeTitle(title)}» — ${date}.</b>\n\nМы обновили её в релизе.`;
}

/** Модератор снял релиз с площадок по просьбе артиста. */
export function releaseRemovedMessage(title: string): string {
  return (
    `🗑 <b>Релиз «${safeTitle(title)}» удалён с площадок.</b>\n\n` +
    `Площадкам нужно до нескольких дней, чтобы убрать его у слушателей. Данные релиза остались в приложении.`
  );
}

/** Ежедневное напоминание: релиз начат больше суток назад и не отправлен. */
export function draftReminderMessage(title: string, status: string): string {
  const next =
    status === "pending"
      ? "Файлы уже загружены — осталось открыть релиз и нажать «Отправить на проверку»."
      : "Черновик сохранён — открой приложение и допиши релиз, это пара минут.";
  return `🎵 <b>Релиз «${safeTitle(title)}» ждёт отправки.</b>\n\n${next}`;
}

/** День выхода релиза: поздравление и ссылка, чтобы сразу поделиться. */
export function releaseDayMessage(title: string, link: string | null): string {
  const head = `🎉 <b>Сегодня выходит «${safeTitle(title)}»!</b>\n\n`;
  return link
    ? `${head}Поделись ссылкой со слушателями и в соцсетях: <a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`
    : `${head}Релиз появится на площадках в течение дня. Поздравляем!`;
}
