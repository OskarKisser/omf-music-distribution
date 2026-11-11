/**
 * Входящие апдейты бота, связанные с карточками: команды /releases и /today и запросы widget_query.
 * Вызывается из /api/telegram/webhook до остальной обработки.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getReleaseStatusLabel } from "@/lib/release-status";
import { escapeHtml, sendTelegramBotMessage } from "@/lib/telegram-bot.server";
import { answerWidgetQuery, type WidgetQuery } from "./api";
import { loadArtistReleases, countUnpaid, loadQueue } from "./data";
import { handleWidgetQueryData } from "./queries";
import { markWidgetOpened } from "./summary";
import { isAdminChat, kickWidgets, sendWidgetCard, widgetAppUrl, type WidgetKind } from "./service";
import { short, utf8Bytes } from "./state";

export type TelegramMessage = {
  message_id?: number;
  from?: { id?: number | string };
  chat?: { id?: number | string; type?: string };
  text?: string;
};

export type BotUpdate = {
  message?: TelegramMessage;
  widget_query?: WidgetQuery;
  [key: string]: unknown;
};

/**
 * widget_query может прийти и как поле, о котором наш тип не знает (новые поля Bot API):
 * достаём его из «сырого» апдейта, а не полагаемся на разбор.
 */
export function extractWidgetQuery(raw: unknown): WidgetQuery | null {
  if (!raw || typeof raw !== "object") return null;
  const q = (raw as Record<string, unknown>).widget_query;
  if (!q || typeof q !== "object") return null;
  const id = (q as Record<string, unknown>).id;
  return typeof id === "string" && id.length > 0 ? (q as WidgetQuery) : null;
}

/** «/releases» или «/releases@omf_bot» → «releases». */
export function parseCommand(text: string | undefined): string | null {
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s|$)/i.exec(text?.trim() ?? "");
  return m ? m[1].toLowerCase() : null;
}

export async function handleWidgetQuery(admin: SupabaseClient, q: WidgetQuery): Promise<void> {
  const started = Date.now();
  let answer = "0";
  let kick = false;
  try {
    const res = await handleWidgetQueryData(admin, q.from?.id, q.data);
    answer = res.answer;
    kick = Boolean(res.kick);
  } catch (e) {
    console.error("[widgets] query failed:", q.data, e);
  }
  const sent = await answerWidgetQuery(q.id, answer);
  console.log(
    `[widgets] query ${q.data ?? "?"} from ${q.from?.id ?? "?"} → ${utf8Bytes(answer)} B in ${Date.now() - started} ms` +
      (sent.ok ? "" : ` (answer failed: ${sent.error})`)
  );
  const from = q.from?.id == null ? "" : String(q.from.id);
  if (from && /^[ra]:/.test(q.data ?? "")) await markWidgetOpened(admin, from, q.data!.startsWith("r:") ? "releases" : "today");
  if (kick) await kickWidgets();
}

/** Прежний текст — если карточка не ушла (выкатка не для всех, старый Telegram, ошибка). */
async function releasesFallback(admin: SupabaseClient, chatId: string): Promise<void> {
  const items = await loadArtistReleases(admin, chatId, new Date()).catch(() => []);
  const lines = items.slice(0, 10).map((it) => `• «${escapeHtml(short(it.release.title || "Без названия", 50))}» — ${escapeHtml(getReleaseStatusLabel(it.release.status).toLowerCase())}`);
  const text = items.length
    ? `🎵 <b>Мои релизы</b>\n\n${lines.join("\n")}${items.length > 10 ? `\n…и ещё ${items.length - 10}` : ""}`
    : "🎵 Релизов пока нет — загрузи первый в приложении.";
  await sendTelegramBotMessage({ chatId, text, replyMarkup: { inline_keyboard: [[{ text: "Открыть приложение", url: widgetAppUrl() }]] } });
}

async function todayFallback(admin: SupabaseClient, chatId: string): Promise<void> {
  const [queue, unpaid] = await Promise.all([loadQueue(admin, new Date()), countUnpaid(admin)]).catch(() => [[], 0] as const);
  const text = `📋 <b>Пульт</b>\n\nНа проверке: ${queue.length}\nОплата не отмечена: ${unpaid}`;
  await sendTelegramBotMessage({ chatId, text, replyMarkup: { inline_keyboard: [[{ text: "Открыть админку", url: `${widgetAppUrl()}?startapp=admin` }]] } });
}

const COMMAND_KIND: Record<string, WidgetKind> = { releases: "releases", today: "today" };

/** Команды карточек в личке с ботом. Возвращает true, если сообщение обработано. */
export async function handleWidgetCommand(admin: SupabaseClient, msg: TelegramMessage): Promise<boolean> {
  const kind = COMMAND_KIND[parseCommand(msg.text) ?? ""];
  const chatId = msg.chat?.id != null ? String(msg.chat.id) : "";
  if (!kind || msg.chat?.type !== "private" || !/^\d+$/.test(chatId)) return false;
  if (kind === "today" && !isAdminChat(chatId)) {
    await sendTelegramBotMessage({ chatId, text: "Эта команда — для администратора. Твои релизы: /releases" });
    return true;
  }
  const sent = await sendWidgetCard(admin, kind, chatId);
  if (!sent.ok) {
    if (sent.reason === "failed") console.warn(`[widgets] /${kind} fallback to text for ${chatId}`);
    await (kind === "releases" ? releasesFallback(admin, chatId) : todayFallback(admin, chatId));
  }
  return true;
}
