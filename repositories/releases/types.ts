import { MAX_WAV_MB } from "@/lib/storage-buckets";
import {
  RELEASE_STATUS_VALUES,
  RELEASE_TYPE_VALUES,
  type ReleaseStatus,
  type ReleaseType
} from "../../lib/db-enums";

export type { ReleaseStatus, ReleaseType };
export { RELEASE_STATUS_VALUES, RELEASE_TYPE_VALUES };

/** Лимиты и допустимые MIME (строгая проверка до загрузки в Storage) */
export const RELEASE_FILE_LIMITS = {
  audioMaxMb: MAX_WAV_MB,
  /** PNG 3000×3000 без сильного сжатия часто > 20 МБ; лимит согласован с клиентом и Storage. */
  artworkMaxMb: 35
} as const;

/** WAV: только явные audio-типы или пустой type с расширением .wav */
export const ALLOWED_AUDIO_MIME = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave"
]);

/** Обложка: только JPEG / PNG */
export const ALLOWED_ARTWORK_MIME = new Set(["image/jpeg", "image/png", "image/jpg"]);

export type ReleaseStep1Payload = {
  user_id: number;
  /** Дублирует Telegram id (для колонки `telegram_id` и RLS). */
  telegram_id: number;
  /** Логин без @; может быть null, если у аккаунта нет username. */
  telegram_username: string | null;
  client_request_id: string;
  artist_name: string;
  track_name: string;
  release_type: ReleaseType;
  genre: string;
  release_date: string;
  explicit: boolean;
};

export type ReleaseStep2Payload = {
  isrc?: string | null;
  authors?: string | null;
  splits?: string | null;
};

export type ReleaseRecord = {
  id: string;
  /** В PostgREST типы могут быть string (bigint / text в схеме). */
  user_id: number | string;
  client_request_id: string;
  artist_name: string;
  /** Название релиза (актуальная колонка в БД). */
  title?: string | null;
  /** Legacy; может отсутствовать, если в БД только `title`. */
  track_name?: string | null;
  release_type: ReleaseType;
  genre: string;
  release_date: string;
  explicit: boolean;
  audio_url: string | null;
  artwork_url: string | null;
  status: ReleaseStatus;
  created_at: string;
  error_message?: string | null;
  /** Комментарий модератора при отклонении (показ в библиотеке). */
  admin_notes?: string | null;
  rejection_reasons?: string[] | null;
  rejection_count?: number | null;
  /** Пользователь начал загрузку WAV, не довёл до конца. */
  draft_upload_started?: boolean;
  /** У пользователя уже есть страницы артиста на DSP. */
  has_existing_profiles?: boolean;
  /** Ссылки на профили артиста (JSON). */
  artist_links?: Record<string, unknown> | null;
  /** Язык исполнения (RU, EN, …). */
  performance_language?: string | null;
  /** Участники релиза с ролями и ссылками (JSON). */
  collaborators?: unknown;
  telegram_id?: number | string | null;
  telegram_username?: string | null;
  /** Вебхук: короткое «релиз получен» уже отправлено (дедуп при pending + tracks). */
  telegram_pending_ack_sent_at?: string | null;
  /** Доп. поля из БД (метаданные дистрибуции). */
  lyrics?: string | null;
  sub_genre?: string | null;
  planned_release_date?: string | null;
  language?: string | null;
  license_type?: string | null;
  mood?: string | null;
  music_author?: string | null;
  author_full_name?: string | null;
  /** Начало отрывка для TikTok, секунды. */
  tiktok_start_sec?: number | null;
  c_line?: string | null;
  p_line?: string | null;
  upc?: string | null;
  user_uuid?: string | null;
  moderator_notes?: string | null;
  /** Дубль explicit в БД (если отличается от `explicit`). */
  is_explicit?: boolean | null;
  /** Публичная smart-link страница / DSP после выпуска (задаётся модерацией). */
  smart_link?: string | null;
  /** Оплата: awaiting | paid | unpaid | not_client (см. lib/release-payment.ts). */
  payment_status?: string | null;
  payment_updated_at?: string | null;
  /** studio — кнопка в боте, admin — админка. */
  payment_updated_by?: string | null;
  /** Когда артист принял условия перед отправкой. */
  terms_accepted_at?: string | null;
  /** Артист попросил снять релиз с площадок (ждёт подтверждения модератора). */
  takedown_requested_at?: string | null;
  takedown_reason?: string | null;
  /** Бот напомнил дописать черновик (cron). */
  draft_reminded_at?: string | null;
  /** Бот поздравил с выходом в день релиза (cron). */
  release_day_notified_at?: string | null;
  /** Форма релиза отправлена в рабочий чат коллег. */
  colleagues_sent_at?: string | null;
  /** Площадка сняла вышедший релиз, ждём возврата (см. lib/platform-issue.ts). */
  platform_issue_platforms?: string[] | null;
  platform_issue_reasons?: string[] | null;
  platform_issue_note?: string | null;
  platform_issue_at?: string | null;
  platform_issue_resolved_at?: string | null;
  /** Модератор заменил обложку после выпуска. */
  artwork_replaced_at?: string | null;
} & ReleaseStep2Payload;

export type UploadAssetOptions = {
  /** 0–100, вызывается при XMLHttpRequest upload progress */
  onProgress?: (percent: number) => void;
  /**
   * При ошибке загрузки: перевести релиз в failed и записать error_message (и лог в release_logs).
   */
  markReleaseFailedOnError?: {
    releaseId: string;
  };
};

export type SubmitReleaseParams = {
  releaseId: string;
  clientRequestId: string;
};

/** Строка таблицы `public.tracks` (см. миграцию 20260330120000_tracks_table.sql). */
export type ReleaseTrackRow = {
  id?: string;
  release_id: string;
  user_id?: number;
  telegram_id?: number | null;
  index: number;
  title: string;
  explicit: boolean;
  /** Публичный URL аудио (в SQL колонка `file_path`). */
  file_path: string | null;
  /** Текст песни (из шага «Треки»). */
  lyrics?: string | null;
  duration?: number | null;
  position?: number | null;
};

/** Публичное название релиза: `title`, иначе legacy `track_name`. */
export function getReleaseDisplayTitle(
  r: Pick<ReleaseRecord, "title" | "track_name">
): string {
  const fromTitle = typeof r.title === "string" ? r.title.trim() : "";
  if (fromTitle.length > 0) return fromTitle;
  return String(r.track_name ?? "").trim();
}
