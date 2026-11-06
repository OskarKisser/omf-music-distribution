import type { ReleaseRecord, ReleaseTrackRow } from "@/repositories/releases.repo";

/** Строка очереди или истории: релиз + треки (GET moderation-queue / moderation-history). */
export type ModerationQueueApiRow = {
  release: ReleaseRecord;
  tracks: ReleaseTrackRow[];
};

export type AdminStatsResponse = {
  ok: true;
  /** Релизы в статусе processing */
  pending_queue: number;
  /** Релизы со статусом ready, созданные с начала текущих суток (UTC) */
  ready_today: number;
  /** Сколько часов ждёт самый старый релиз в очереди (по логу finalize); null, если очередь пуста. */
  oldest_wait_hours: number | null;
  /** За последние 30 дней: одобрено / отклонено (по текущему статусу релизов). */
  ready_30d: number;
  failed_30d: number;
  /** Самые частые причины отклонения за 30 дней. */
  top_reject_reasons: { key: string; count: number }[];
  /** Уникальные пользователи по шагам мастера за 30 дней + отправки. */
  funnel_30d: { step: string; users: number }[];
  /** Начатые, но не отправленные релизы (draft / pending), старше STUCK_AFTER_MIN минут. */
  stuck: AdminStuckRelease[];
};

export type AdminStuckRelease = {
  id: string;
  title: string;
  artist_name: string;
  status: "draft" | "pending";
  artwork_url: string | null;
  telegram_username: string | null;
  /** Есть Telegram id — бот может написать напоминание. */
  can_remind?: boolean;
  created_at: string;
  tracks_count: number;
};

/** Принятый релиз, которому ещё не добавили ссылку на пресейв. */
export type AdminAwaitingLinkRelease = {
  id: string;
  title: string;
  artist_name: string;
  artwork_url: string | null;
  telegram_username: string | null;
  upc: string | null;
  /** Желаемая дата выхода `YYYY-MM-DD`: сверить перед отправкой ссылки. */
  release_date: string | null;
  /** Когда приняли (лог), для старых релизов — дата создания. */
  accepted_at: string;
};

/** Принятый (отгруженный) релиз для каталога: GET /api/admin/catalog. */
export type AdminCatalogRelease = {
  id: string;
  title: string;
  artist_name: string;
  featuring: string[];
  release_type: "single" | "ep" | "album";
  genre: string | null;
  artwork_url: string | null;
  smart_link: string | null;
  upc: string | null;
  /** Когда приняли (лог), для старых релизов — дата создания. */
  accepted_at: string;
  /** Без строк в `tracks` (старые синглы) — один трек с названием релиза. */
  tracks: { title: string; explicit: boolean; duration: number | null }[];
  /** Дата выхода на площадках (YYYY-MM-DD), если артист указал. */
  release_date: string | null;
  /** Когда артист последний раз сохранил заполненный питчинг; null — не заполнял. */
  pitched_at: string | null;
};
