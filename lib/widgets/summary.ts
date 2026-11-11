/**
 * Сводка по карточкам админу — по понедельникам вместе с утренним пультом.
 * «Открывали» считается по last_query_at (нажатия в карточке); без колонки строка просто не выводится.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getExpectedAdminTelegramId } from "@/lib/admin";
import { sendTelegramBotMessage } from "@/lib/telegram-bot.server";

const TABLE = "widget_messages";
const WEEK_MS = 7 * 24 * 36e5;

/** Запомнить, что в карточке нажимали. Ошибки не мешают ответу (например, колонки ещё нет). */
export async function markWidgetOpened(admin: SupabaseClient, chatId: string, kind: "releases" | "today"): Promise<void> {
  const { error } = await admin
    .from(TABLE)
    .update({ last_query_at: new Date().toISOString() })
    .eq("chat_id", chatId)
    .eq("kind", kind);
  if (error && !/last_query_at/.test(error.message)) console.warn("[widgets] mark opened:", error.message);
}

export type WidgetSummary = { cards: number; opened: number | null; updated: number };

export async function loadWidgetSummary(admin: SupabaseClient, now: Date): Promise<WidgetSummary> {
  const since = new Date(now.getTime() - WEEK_MS).toISOString();
  const adminId = String(getExpectedAdminTelegramId());
  const base = () => admin.from(TABLE).select("chat_id", { count: "exact", head: true }).eq("kind", "releases").neq("chat_id", adminId);
  const [all, upd, opened] = await Promise.all([base(), base().gte("updated_at", since), base().gte("last_query_at", since)]);
  if (all.error) throw new Error(`widgets summary: ${all.error.message}`);
  return { cards: all.count ?? 0, updated: upd.count ?? 0, opened: opened.error ? null : opened.count ?? 0 };
}

export function summaryText(s: WidgetSummary): string {
  return (
    "📊 <b>Карточки за неделю</b>\n\n" +
    `«Мои релизы» есть у артистов: ${s.cards}\n` +
    (s.opened == null ? "" : `Открывали карточку: ${s.opened}\n`) +
    `Карточка обновлялась (что-то менялось в релизах): ${s.updated}`
  );
}

/** По понедельникам (по Москве) — сводка админу. В остальные дни ничего не делает. */
export async function sendWeeklyWidgetSummary(admin: SupabaseClient, now: Date): Promise<string> {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Moscow", weekday: "short" }).format(now);
  if (day !== "Mon") return "skipped";
  const s = await loadWidgetSummary(admin, now);
  const r = await sendTelegramBotMessage({ chatId: String(getExpectedAdminTelegramId()), text: summaryText(s) });
  return r.ok ? "sent" : `failed: ${r.error}`;
}
