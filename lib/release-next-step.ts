import { normalizeReleaseStatus } from "@/lib/release-status";
import { platformIssueBody, platformIssueCardLine, type PlatformIssue } from "@/lib/platform-issue";

/** Обещанный артисту срок проверки (тот же, что в тексте после отправки). */
export const MODERATION_SLA_HOURS = 24;

/** Сколько обычно идёт модерация на площадках после того, как мы приняли релиз. */
export const DSP_REVIEW_DAYS_TEXT = "3–5 дней";

export type NextStepKind =
  | "finish_draft"
  | "submit"
  | "fix"
  | "waiting"
  | "waiting_long"
  | "approved_link"
  | "approved_no_link"
  | "updating"
  | "removed"
  | "unknown";

/** Цвет строки: action — нужен шаг артиста, problem — вернули, wait — ждём, done — готово. */
export type NextStepTone = "action" | "problem" | "wait" | "warn" | "done" | "muted";

export type ReleaseNextStep = {
  kind: NextStepKind;
  tone: NextStepTone;
  /** Короткая строка на плитке библиотеки (влезает в ~170px). */
  cardLine: string;
  /** Заголовок блока статуса на экране релиза. */
  title: string;
  body: string;
  /** Артисту нужно что-то сделать самому. */
  needsAction: boolean;
};

export type NextStepInput = {
  status: string | null | undefined;
  smartLink?: string | null;
  /** Когда релиз ушёл на проверку (ISO), если известно. */
  submittedAt?: string | null;
  /** Решение придёт сообщением в Telegram (у веб-аккаунтов без Telegram — нет). */
  notifiesInTelegram?: boolean;
  /** Площадка сняла вышедший релиз — обновляем (см. lib/platform-issue.ts). */
  platformIssue?: PlatformIssue | null;
};

/** «меньше часа», «3 ч», «2 дн». */
export function formatWaitDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours < 1) return "меньше часа";
  if (hours < 24) return `${Math.floor(hours)} ч`;
  return `${Math.floor(hours / 24)} дн`;
}

function waitedHours(submittedAt: string | null | undefined, now: Date): number | null {
  if (!submittedAt) return null;
  const t = new Date(submittedAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, (now.getTime() - t) / 36e5);
}

/** Где релиз и что делать дальше — одна формулировка для плитки и экрана релиза. */
export function getReleaseNextStep(input: NextStepInput, now: Date = new Date()): ReleaseNextStep {
  const status = normalizeReleaseStatus(input.status);
  const link = input.smartLink?.trim() ?? "";

  switch (status) {
    case "draft":
      return {
        kind: "finish_draft",
        tone: "action",
        cardLine: "Допиши и отправь",
        title: "Черновик",
        body: "Релиз ещё не отправлен. Продолжи с того места, где остановился, и отправь на проверку.",
        needsAction: true
      };
    case "pending":
      return {
        kind: "submit",
        tone: "action",
        cardLine: "Осталось отправить",
        title: "Не отправлен",
        body: "Файлы загружены, но релиз ещё не ушёл на проверку. Открой его и нажми «Отправить на проверку».",
        needsAction: true
      };
    case "failed":
      return {
        kind: "fix",
        tone: "problem",
        cardLine: "Исправь замечания",
        title: "Вернули на доработку",
        body: "Модератор вернул релиз. Исправь замечания и отправь снова — файлы уже загружены.",
        needsAction: true
      };
    case "processing": {
      const hours = waitedHours(input.submittedAt, now);
      const notify = input.notifiesInTelegram
        ? "Когда будет решение, статус обновится здесь и придёт сообщение в Telegram."
        : "Когда будет решение, статус обновится здесь.";
      if (hours != null && hours >= MODERATION_SLA_HOURS) {
        return {
          kind: "waiting_long",
          tone: "warn",
          cardLine: "Дольше обычного",
          title: "Проверка затянулась",
          body: `Релиз на проверке ${formatWaitDuration(hours)}, обычно это до ${MODERATION_SLA_HOURS} часов. Напиши в поддержку в разделе «Помощь» — посмотрим, что случилось.`,
          needsAction: false
        };
      }
      return {
        kind: "waiting",
        tone: "wait",
        cardLine: hours != null ? `На проверке ${formatWaitDuration(hours)}` : `Проверка до ${MODERATION_SLA_HOURS} ч`,
        title: "На проверке",
        body: `${hours != null ? `Отправлен ${formatWaitDuration(hours)} назад. ` : ""}Модератор проверяет паспорт, обложку и аудио, обычно до ${MODERATION_SLA_HOURS} часов. ${notify}`,
        needsAction: false
      };
    }
    case "ready": {
      if (input.platformIssue) {
        return {
          kind: "updating",
          tone: "warn",
          cardLine: platformIssueCardLine(input.platformIssue),
          title: "Обновляем на площадках",
          body: platformIssueBody(input.platformIssue, Boolean(input.notifiesInTelegram)),
          needsAction: false
        };
      }
      const notify = input.notifiesInTelegram ? " сюда и в Telegram" : " сюда";
      return link
        ? {
            kind: "approved_link",
            tone: "done",
            cardLine: "Ссылка готова",
            title: "Ссылка готова",
            body: "Релиз прошёл модерацию площадок. Ссылка на пресейв — ниже: отправляй её слушателям и в соцсети.",
            needsAction: false
          }
        : {
            kind: "approved_no_link",
            tone: "done",
            cardLine: "Ссылка через 3–5 дн",
            title: "Принят",
            body: `Релиз принят и отправлен на площадки. Их модерация обычно занимает ${DSP_REVIEW_DAYS_TEXT} — когда пройдёт, пришлём ссылку на пресейв${notify}.`,
            needsAction: false
          };
    }
    case "removed":
      return {
        kind: "removed",
        tone: "muted",
        cardLine: "Удалён с площадок",
        title: "Удалён с площадок",
        body: "Релиз снят со всех площадок по твоей просьбе. Данные релиза остались здесь — для истории.",
        needsAction: false
      };
    default:
      return {
        kind: "unknown",
        tone: "muted",
        cardLine: "",
        title: "Статус уточняется",
        body: "Не получилось определить статус релиза. Обнови страницу чуть позже.",
        needsAction: false
      };
  }
}

export const NEXT_STEP_TONE_CLASS: Record<NextStepTone, string> = {
  action: "text-omf-ink font-medium",
  problem: "text-omf-red font-medium",
  wait: "text-omf-graphite",
  warn: "text-omf-yellow",
  done: "text-omf-green",
  muted: "text-omf-graphite"
};

/** «1 релиз», «2 релиза», «5 релизов». */
export function pluralRu(n: number, forms: readonly [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export type LibraryActionKind = "fix" | "unsent";

export type LibraryAction = {
  kind: LibraryActionKind;
  count: number;
  /** Самый свежий релиз этой группы — его открываем, если он один. */
  firstId: string;
  text: string;
};

/**
 * Что артисту нужно сделать самому (для строки в начале библиотеки):
 * сначала возвращённые модератором, потом не отправленные (черновик + «не отправлен»).
 * `rows` — в порядке списка (новые сверху).
 */
export function collectLibraryActions(
  rows: readonly { id: string; status: string | null | undefined }[]
): LibraryAction[] {
  const fix: string[] = [];
  const unsent: string[] = [];
  for (const r of rows) {
    const kind = getReleaseNextStep({ status: r.status }).kind;
    if (kind === "fix") fix.push(r.id);
    else if (kind === "finish_draft" || kind === "submit") unsent.push(r.id);
  }
  const out: LibraryAction[] = [];
  if (fix.length > 0) {
    out.push({
      kind: "fix",
      count: fix.length,
      firstId: fix[0],
      text:
        fix.length === 1
          ? "Релиз вернули"
          : `${fix.length} ${pluralRu(fix.length, ["релиз", "релиза", "релизов"])} вернули`
    });
  }
  if (unsent.length > 0) {
    out.push({
      kind: "unsent",
      count: unsent.length,
      firstId: unsent[0],
      text:
        unsent.length === 1
          ? "Релиз не отправлен"
          : `${unsent.length} ${pluralRu(unsent.length, ["релиз", "релиза", "релизов"])} не отправлены`
    });
  }
  return out;
}
