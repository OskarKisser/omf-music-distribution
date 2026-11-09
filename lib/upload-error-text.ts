import { formatErrorMessage } from "@/lib/errors";
import { MAX_WAV_MB } from "@/lib/storage-buckets";

/** На каком шаге упала загрузка: сам файл в хранилище или запись трека в базу. */
export type UploadErrorPhase = "storage" | "database";

const SUPPORT_HINT = "Попробуй ещё раз; если не поможет, напиши в поддержку.";

/** Слова, которые артисту ничего не говорят: такой текст наружу не показываем. */
const TECHNICAL = /bucket|rls|row-level|schema|postgrest|supabase|\btracks\b|\bhttp\b|json|undefined|null/i;

function errorStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const o = err as { statusCode?: unknown; status?: unknown };
  const n = Number(o.statusCode ?? o.status);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Сообщение уже написано для человека: по-русски и без технических слов. */
function isUserFacing(message: string): boolean {
  return /[а-яё]/i.test(message) && !TECHNICAL.test(message);
}

function isNetworkFailure(lower: string, status: number | null): boolean {
  if (status != null) return false;
  return (
    lower.length === 0 ||
    /failed to fetch|network|load failed|tus:|timeout|timed out|abort|offline|connection|socket/.test(lower)
  );
}

/**
 * Текст ошибки загрузки файла для артиста: что случилось и что сделать.
 * Технические детали (коды, ответы хранилища) остаются в логах.
 */
export function userUploadErrorText(err: unknown, phase: UploadErrorPhase): string {
  const raw = formatErrorMessage(err, "").trim();
  if (isUserFacing(raw)) return raw;

  const lower = raw.toLowerCase();
  const status = errorStatus(err);

  if (status === 413 || /too large|maximum size|exceed|payload/.test(lower)) {
    return `Файл слишком большой (лимит ${MAX_WAV_MB} МБ). Сожми WAV или выбери файл поменьше.`;
  }
  if (status === 401 || status === 403 || /unauthor|forbidden|permission|row-level|jwt/.test(lower)) {
    return "Нет доступа к загрузке файла. Открой приложение из Telegram заново и попробуй ещё раз.";
  }
  if (isNetworkFailure(lower, status)) {
    return "Загрузка файла прервалась: проверь интернет и попробуй ещё раз.";
  }
  if (phase === "database") {
    return `Файл загружен, но сохранить трек не получилось. ${SUPPORT_HINT}`;
  }
  return `Не получилось загрузить файл. ${SUPPORT_HINT}`;
}

/** Текст ошибки отправки релиза (всё, кроме загрузки файлов). */
export function userSubmitErrorText(err: unknown): string {
  const raw = formatErrorMessage(err, "").trim();
  if (isUserFacing(raw)) return raw;

  const status = errorStatus(err);
  if (status === 401 || status === 403 || /unauthor|forbidden|jwt/.test(raw.toLowerCase())) {
    return "Нет доступа к отправке. Открой приложение из Telegram заново и попробуй ещё раз.";
  }
  if (isNetworkFailure(raw.toLowerCase(), status)) {
    return "Не получилось отправить релиз: проверь интернет и попробуй ещё раз.";
  }
  return `Не получилось отправить релиз. ${SUPPORT_HINT}`;
}
