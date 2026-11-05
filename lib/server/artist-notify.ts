import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { getUserProfileByTelegramId } from "@/lib/auth/hybrid-auth";
import { sendTelegramNotification } from "@/lib/telegram-notifications";

type NotifiableRelease = {
  telegram_id?: unknown;
  user_uuid?: string | null;
};

/** Какой переключатель профиля отвечает за сообщение. */
export type ArtistNotifyKind = "release" | "draft_reminder" | "release_day";

const PREF_COLUMN: Record<ArtistNotifyKind, string> = {
  release: "push_notifications",
  draft_reminder: "notify_draft_reminder",
  release_day: "notify_release_day"
};

/** Уважает переключатели в профиле (user_preferences). Ошибки и нет колонки → считаем, что можно. */
async function isPushEnabled(record: NotifiableRelease, telegramId: string, kind: ArtistNotifyKind): Promise<boolean> {
  try {
    const admin = createSupabaseAdmin();
    if (!admin) return true;
    let uuid = typeof record.user_uuid === "string" && record.user_uuid ? record.user_uuid : null;
    if (!uuid) {
      const profile = await getUserProfileByTelegramId(BigInt(telegramId));
      uuid = profile?.id ?? null;
    }
    if (!uuid) return true;
    const { data } = await admin
      .from("user_preferences")
      .select("*")
      .eq("user_uuid", uuid)
      .maybeSingle();
    return (data as Record<string, unknown> | null)?.[PREF_COLUMN[kind]] !== false;
  } catch {
    return true;
  }
}

/**
 * Сообщение артисту в Telegram о событии по релизу.
 * Пропускается, если у релиза нет telegram_id (веб-аккаунт) или артист выключил уведомления.
 * Возвращает `false`, если сообщение не отправляли.
 * Веб-пользователи видят изменения статуса в приложении (метка «Новое» в списке релизов).
 */
export async function notifyArtist(
  record: NotifiableRelease,
  text: string,
  kind: ArtistNotifyKind = "release"
): Promise<boolean> {
  const tid = artistTelegramId(record);
  if (!tid) return false;
  if (!(await isPushEnabled(record, tid, kind))) return false;
  await sendTelegramNotification(tid, text);
  return true;
}

/** Числовой Telegram id артиста из релиза; `null` у веб-аккаунтов без Telegram. */
export function artistTelegramId(record: NotifiableRelease): string | null {
  const tid =
    record.telegram_id != null && String(record.telegram_id).trim() !== ""
      ? String(record.telegram_id).trim()
      : null;
  return tid && /^\d+$/.test(tid) ? tid : null;
}
