/**
 * «Принять» релиз из очереди модерации: статус ready без ссылки — релиз ушёл дистрибьюторам,
 * ссылку модератор добавит позже (publish-release-smart-link). WAV не удаляем.
 * Одна функция для админки и для карточки «Пульт»: кэш, учёт принятия и сообщение артисту — в одном месте.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReleaseRecord } from "@/repositories/releases.repo";
import { acceptedMessage } from "@/lib/server/release-notify-texts";
import { logAccepted } from "@/lib/server/release-accepted-at";
import { notifyArtist } from "@/lib/server/artist-notify";
import { invalidateMyReleasesCache } from "@/lib/server/release-list-cache";
import { getReleaseDisplayTitle } from "@/repositories/releases.repo";

export type ApproveResult =
  | { ok: true; record: ReleaseRecord }
  | { ok: false; status: 404 | 409 | 500; error: string };

export async function approveRelease(supabase: SupabaseClient, releaseId: string): Promise<ApproveResult> {
  const { data: row, error: loadErr } = await supabase.from("releases").select("id, status").eq("id", releaseId).maybeSingle();
  if (loadErr) {
    console.error("[release-approve] load:", loadErr.message);
    return { ok: false, status: 500, error: "Не удалось загрузить релиз." };
  }
  if (!row) return { ok: false, status: 404, error: "Релиз не найден." };
  if ((row as { status?: string }).status !== "processing") {
    return { ok: false, status: 409, error: "Релиз не в очереди модерации (ожидался статус processing)." };
  }

  // Условие на статус — если два модератора нажали одновременно, сообщение артисту уйдёт один раз.
  const { data: updated, error: updErr } = await supabase
    .from("releases")
    .update({ status: "ready", error_message: null, admin_notes: null })
    .eq("id", releaseId)
    .eq("status", "processing")
    .select("*")
    .maybeSingle();
  if (updErr) {
    console.error("[release-approve] update:", updErr.message);
    return { ok: false, status: 500, error: "Не удалось одобрить релиз." };
  }
  if (!updated) return { ok: false, status: 409, error: "Релиз уже обработан." };

  const record = updated as ReleaseRecord;
  await invalidateMyReleasesCache(updated as Record<string, unknown>);
  await logAccepted(supabase, releaseId);
  await notifyArtist(record, acceptedMessage(getReleaseDisplayTitle(record)));
  return { ok: true, record };
}
