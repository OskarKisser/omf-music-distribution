import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyArtist } from "@/lib/server/artist-notify";
import { draftReminderMessage, releaseDayMessage } from "@/lib/server/release-notify-texts";
import { getReleaseDisplayTitle, type ReleaseRecord } from "@/repositories/releases/types";

/** Напоминаем, если черновик начат больше суток назад; совсем старые (2 недели+) не трогаем. */
export const DRAFT_REMIND_AFTER_HOURS = 24;
export const DRAFT_REMIND_MAX_AGE_DAYS = 14;
/** Сколько сообщений за один запуск — с запасом под лимиты Telegram и время функции. */
const BATCH_LIMIT = 100;

/** Сегодняшняя дата в Москве (YYYY-MM-DD) — даты релизов артисты выбирают по московскому времени. */
export function moscowToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

/** Окно `created_at` для напоминания о черновике. */
export function draftReminderWindow(now: Date = new Date()): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - DRAFT_REMIND_MAX_AGE_DAYS * 24 * 36e5).toISOString(),
    to: new Date(now.getTime() - DRAFT_REMIND_AFTER_HOURS * 36e5).toISOString()
  };
}

export type JobResult = { candidates: number; sent: number };

const NOTIFY_COLUMNS = "id, title, track_name, status, telegram_id, user_uuid, smart_link, release_date";

/** Один раз напомнить дописать релиз: черновик или «файлы загружены, не отправлен». */
export async function remindUnfinishedDrafts(admin: SupabaseClient, now: Date = new Date()): Promise<JobResult> {
  const { from, to } = draftReminderWindow(now);
  const { data, error } = await admin
    .from("releases")
    .select(NOTIFY_COLUMNS)
    .in("status", ["draft", "pending"])
    .is("draft_reminded_at", null)
    .not("telegram_id", "is", null)
    .gte("created_at", from)
    .lte("created_at", to)
    .limit(BATCH_LIMIT);
  if (error) throw new Error(`drafts: ${error.message}`);

  let sent = 0;
  for (const row of (data ?? []) as unknown as ReleaseRecord[]) {
    // Отмечаем до отправки: при сбое лучше не написать, чем написать дважды.
    const { error: markErr } = await admin
      .from("releases")
      .update({ draft_reminded_at: now.toISOString() })
      .eq("id", row.id)
      .is("draft_reminded_at", null);
    if (markErr) continue;
    if (await notifyArtist(row, draftReminderMessage(getReleaseDisplayTitle(row), String(row.status)), "draft_reminder")) sent += 1;
  }
  return { candidates: data?.length ?? 0, sent };
}

/** В день выхода: поздравить и дать ссылку, чтобы артист сразу поделился. */
export async function congratulateReleaseDay(admin: SupabaseClient, now: Date = new Date()): Promise<JobResult> {
  const { data, error } = await admin
    .from("releases")
    .select(NOTIFY_COLUMNS)
    .eq("status", "ready")
    // Колонка текстовая: бывает «2026-11-05» и «2026-11-05T00:00:00» — сравниваем по началу.
    .like("release_date", `${moscowToday(now)}%`)
    .is("release_day_notified_at", null)
    .not("telegram_id", "is", null)
    .limit(BATCH_LIMIT);
  if (error) throw new Error(`release day: ${error.message}`);

  let sent = 0;
  for (const row of (data ?? []) as unknown as ReleaseRecord[]) {
    const { error: markErr } = await admin
      .from("releases")
      .update({ release_day_notified_at: now.toISOString() })
      .eq("id", row.id)
      .is("release_day_notified_at", null);
    if (markErr) continue;
    const link = row.smart_link?.trim() || null;
    if (await notifyArtist(row, releaseDayMessage(getReleaseDisplayTitle(row), link), "release_day")) sent += 1;
  }
  return { candidates: data?.length ?? 0, sent };
}
