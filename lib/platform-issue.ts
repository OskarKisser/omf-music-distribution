import { DSP_REVIEW_DAYS_TEXT } from "@/lib/release-next-step";

/**
 * Площадка сняла уже вышедший релиз (например, Apple Music из-за обложки), мы отправили исправление.
 * Пока проблема активна, артист видит «Обновляем на площадках», а не «Ссылка готова».
 */

export const PLATFORM_ISSUE_PLATFORMS = [
  { key: "apple_music", label: "Apple Music" },
  { key: "itunes", label: "iTunes" },
  { key: "spotify", label: "Spotify" },
  { key: "yandex", label: "Яндекс Музыка" },
  { key: "vk", label: "VK Музыка" },
  { key: "youtube", label: "YouTube Music" },
  { key: "other", label: "Другие" }
] as const;

export type PlatformIssuePlatform = (typeof PLATFORM_ISSUE_PLATFORMS)[number]["key"];

export const PLATFORM_ISSUE_REASONS = [
  { key: "artwork", label: "Обложка", because: "обложки", sent: "Новую обложку", review: "Новая обложка" },
  { key: "title", label: "Название", because: "названия", sent: "Исправленное название", review: "Исправленное название" },
  { key: "lyrics", label: "Текст", because: "текста", sent: "Исправленный текст", review: "Исправленный текст" },
  { key: "audio", label: "Аудио", because: "аудио", sent: "Новое аудио", review: "Новое аудио" },
  { key: "other", label: "Другое", because: null, sent: "Исправления", review: "Исправления" }
] as const;

export type PlatformIssueReason = (typeof PLATFORM_ISSUE_REASONS)[number]["key"];

export const PLATFORM_ISSUE_PLATFORM_KEYS = PLATFORM_ISSUE_PLATFORMS.map((p) => p.key) as [
  PlatformIssuePlatform,
  ...PlatformIssuePlatform[]
];
export const PLATFORM_ISSUE_REASON_KEYS = PLATFORM_ISSUE_REASONS.map((r) => r.key) as [
  PlatformIssueReason,
  ...PlatformIssueReason[]
];

export type PlatformIssue = {
  platforms: PlatformIssuePlatform[];
  reasons: PlatformIssueReason[];
  note: string | null;
  at: string;
};

type PlatformIssueRow = {
  platform_issue_platforms?: string[] | null;
  platform_issue_reasons?: string[] | null;
  platform_issue_note?: string | null;
  platform_issue_at?: string | null;
};

function pick<T extends string>(values: string[] | null | undefined, allowed: readonly T[]): T[] {
  const set = new Set(values ?? []);
  return allowed.filter((k) => set.has(k));
}

/** Активная проблема на площадках или null. Неизвестные ключи отбрасываем, порядок — как в списках выше. */
export function readPlatformIssue(row: PlatformIssueRow | null | undefined): PlatformIssue | null {
  if (!row?.platform_issue_at) return null;
  const platforms = pick(row.platform_issue_platforms, PLATFORM_ISSUE_PLATFORM_KEYS);
  return {
    platforms: platforms.length > 0 ? platforms : ["other"],
    reasons: pick(row.platform_issue_reasons, PLATFORM_ISSUE_REASON_KEYS),
    note: row.platform_issue_note?.trim() || null,
    at: row.platform_issue_at
  };
}

function joinRu(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} и ${items[items.length - 1]}`;
}

/** «Apple Music и iTunes», «Spotify, VK Музыка и другие площадки», «Одна из площадок». */
export function formatPlatforms(platforms: readonly PlatformIssuePlatform[]): string {
  const named: string[] = PLATFORM_ISSUE_PLATFORMS.filter((p) => p.key !== "other" && platforms.includes(p.key)).map(
    (p) => p.label
  );
  if (named.length === 0) return "Одна из площадок";
  if (platforms.includes("other")) named.push("другие площадки");
  return joinRu(named);
}

/** Коротко для строки библиотеки: «Обновляем в Apple Music» (iTunes — та же витрина Apple). */
export function platformIssueCardLine(issue: PlatformIssue): string {
  const groups = new Set(issue.platforms.map((p) => (p === "itunes" ? "apple_music" : p)));
  if (groups.size === 1 && !groups.has("other")) {
    const only = [...groups][0];
    const label = PLATFORM_ISSUE_PLATFORMS.find((p) => p.key === only)?.label;
    if (label) return `Обновляем в ${label}`;
  }
  return "Обновляем на площадках";
}

/** «из-за обложки», «из-за обложки и названия» или пусто. */
function becausePhrase(reasons: readonly PlatformIssueReason[]): string {
  const words = PLATFORM_ISSUE_REASONS.filter((r) => reasons.includes(r.key) && r.because).map((r) => r.because!);
  return words.length > 0 ? ` из-за ${joinRu(words)}` : "";
}

function fixWord(reasons: readonly PlatformIssueReason[], form: "sent" | "review"): string {
  if (reasons.length === 1) {
    const r = PLATFORM_ISSUE_REASONS.find((x) => x.key === reasons[0]);
    if (r) return r[form];
  }
  return "Исправления";
}

/** Текст под заголовком статуса на экране релиза. */
export function platformIssueBody(issue: PlatformIssue, notifiesInTelegram: boolean): string {
  const review = fixWord(issue.reasons, "review");
  const tail = notifiesInTelegram ? " Напишем в бот, когда вернётся." : " Статус обновится здесь, когда вернётся.";
  return (
    `${formatPlatforms(issue.platforms)} временно сняли релиз${becausePhrase(issue.reasons)}. ` +
    `${review} уже на проверке — обычно ${DSP_REVIEW_DAYS_TEXT}.${tail}`
  );
}

function safeTitle(title: string): string {
  return title.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}

/** Сообщение артисту, когда отметили проблему. */
export function platformIssueMessage(title: string, issue: Pick<PlatformIssue, "platforms" | "reasons">): string {
  return (
    `🔄 <b>«${safeTitle(title)}»: обновляем на площадках.</b>\n\n` +
    `${formatPlatforms(issue.platforms)} временно сняли релиз${becausePhrase(issue.reasons)}. ` +
    `${fixWord(issue.reasons, "sent")} уже отправили — обычно это ${DSP_REVIEW_DAYS_TEXT}. ` +
    `Напишем, когда релиз вернётся. На остальных площадках всё на месте.`
  );
}

/** Сообщение артисту, когда релиз вернулся. */
export function platformIssueResolvedMessage(title: string): string {
  return (
    `✅ <b>«${safeTitle(title)}» снова на всех площадках.</b>\n\n` +
    `Ссылка та же — можно делиться.`
  );
}
