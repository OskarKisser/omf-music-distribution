import { normalizeReleaseStatus } from "@/lib/release-status";

/**
 * Снять с площадок можно только релиз, который ушёл модератору: на проверке или принятый.
 * Черновик/«не отправлен»/отклонённый на площадки не попадали — снимать нечего.
 */
export function canRequestTakedown(status: string | null | undefined): boolean {
  const s = normalizeReleaseStatus(status);
  return s === "processing" || s === "ready";
}

/** Модератор подтверждает снятие: релиз был отправлен и ещё не удалён. */
export function canConfirmTakedown(status: string | null | undefined): boolean {
  return canRequestTakedown(status);
}
