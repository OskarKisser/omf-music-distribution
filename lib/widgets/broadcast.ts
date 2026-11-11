/**
 * Рассылка о карточках: отдельно админу (как всё устроено) и артистам (инструкция).
 * Сначала сухой прогон — список получателей без отправки.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getExpectedAdminTelegramId } from "@/lib/admin";
import { sendTelegramBotMessage } from "@/lib/telegram-bot.server";

export type BroadcastRole = "admin" | "artists";

const UPDATE_NOTE =
  "Карточки работают в свежем Telegram на телефоне: обнови приложение (а если телефон давно не обновлялся — и систему). " +
  "На компьютере карточек пока нет — там вместо них будет короткая подпись.";

export const BROADCAST_TEXT: Record<BroadcastRole, string> = {
  admin:
    "🧩 <b>В боте появились живые карточки</b>\n\n" +
    "<b>/today — Пульт.</b> Очередь на проверке с полосками ожидания (красная — дольше суток), новые за сутки и оплаты. " +
    "Вкладка «Оплата»: нажми на релиз — «Оплатил / Не оплатил / Не клиент». Это те же отметки, что кнопки «Оплатил?» и админка: скидка и бонус за друга считаются как раньше. " +
    "Нажатие на релиз в очереди открывает его в админке.\n\n" +
    "<b>/releases — Мои релизы</b> у артистов: где каждый релиз, что сделать, ближайший выход. Артист видит только свои релизы.\n\n" +
    "Карточки обновляются сами: сразу после событий и раз в минуту. Пульт приходит каждое утро в 10:00, «Мои релизы» — артисту после отправки релиза. " +
    "Прежние сообщения бота никуда не делись.\n\n" +
    UPDATE_NOTE,
  artists:
    "🎵 <b>Новое в боте: карточка «Мои релизы»</b>\n\n" +
    "Отправь /releases — придёт живая карточка со всеми твоими релизами: где каждый сейчас (проверка → площадки → ссылка → выход) и что сделать тебе. " +
    "Вкладки «Ждут меня» и «Готовы», внизу — ближайший выход и готовые ссылки. Нажми на релиз — подробности и кнопка «Открыть в приложении».\n\n" +
    "Карточка обновляется сама, когда что-то меняется. Сообщения от бота тоже приходят как раньше.\n\n" +
    UPDATE_NOTE
};

export async function broadcastRecipients(admin: SupabaseClient, role: BroadcastRole): Promise<string[]> {
  const adminId = String(getExpectedAdminTelegramId());
  if (role === "admin") return [adminId];
  const { data, error } = await admin.from("releases").select("telegram_id").not("telegram_id", "is", null).limit(5000);
  if (error) throw new Error(`recipients: ${error.message}`);
  const ids = new Set<string>();
  for (const r of (data ?? []) as { telegram_id: unknown }[]) {
    const id = String(r.telegram_id ?? "").trim();
    if (/^\d+$/.test(id) && id !== adminId) ids.add(id);
  }
  return [...ids];
}

export type BroadcastReport = {
  role: BroadcastRole;
  dryRun: boolean;
  recipients: string[];
  delivered: number;
  failed: Array<{ chatId: string; error: string }>;
};

export async function runBroadcast(admin: SupabaseClient, role: BroadcastRole, dryRun: boolean): Promise<BroadcastReport> {
  const recipients = await broadcastRecipients(admin, role);
  const report: BroadcastReport = { role, dryRun, recipients, delivered: 0, failed: [] };
  if (dryRun) return report;
  for (const chatId of recipients) {
    const r = await sendTelegramBotMessage({ chatId, text: BROADCAST_TEXT[role] });
    if (r.ok) report.delivered += 1;
    else report.failed.push({ chatId, error: r.error });
    // Не быстрее ~20 сообщений в секунду.
    await new Promise((res) => setTimeout(res, 60));
  }
  console.log(`[widgets] broadcast ${role}: ${report.delivered}/${recipients.length}`, JSON.stringify(report.failed));
  return report;
}
