import { shouldShowSmartLinkCta } from "@/lib/smart-link-cta";

/** Питчинг: пресс-релиз и фото артиста для редакций площадок. Правила общие для клиента и API. */

export const PRESS_TEXT_MAX = 300;
export const PRESS_PHOTO_MAX_MB = 10;
export const PRESS_PHOTO_MAX_BYTES = PRESS_PHOTO_MAX_MB * 1024 * 1024;
/** Короче этой стороны редактору нечего вырезать на обложку плейлиста. */
export const PRESS_PHOTO_MIN_SIDE_PX = 1000;

const PHOTO_EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
} as const;

export type PressPhotoMime = keyof typeof PHOTO_EXT_BY_MIME;

export function isPressPhotoMime(mime: string): mime is PressPhotoMime {
  return Object.prototype.hasOwnProperty.call(PHOTO_EXT_BY_MIME, mime);
}

export function pressPhotoExt(mime: PressPhotoMime): string {
  return PHOTO_EXT_BY_MIME[mime];
}

/** Питчинг открыт, когда релиз выпущен и артисту отдали BandLink. */
export function isPitchingOpen(
  status: string | null | undefined,
  smartLink: string | null | undefined
): boolean {
  return shouldShowSmartLinkCta(status, smartLink);
}

/** Пустой текст после trim — null. Длина не проверяется: это делает `pressTextError`. */
export function normalizePressText(raw: string | null | undefined): string | null {
  const t = (raw ?? "").replace(/\r\n?/g, "\n").trim();
  return t.length > 0 ? t : null;
}

/** Длина в символах, как её считает Postgres `char_length` (эмодзи — один символ). */
export function pressTextLength(text: string): number {
  return Array.from(text).length;
}

export function pressTextError(text: string | null): string | null {
  if (text != null && pressTextLength(text) > PRESS_TEXT_MAX) {
    return `Текст длиннее ${PRESS_TEXT_MAX} символов.`;
  }
  return null;
}

/** Путь фото внутри бакета: всегда в папке своего релиза. */
export function isOwnPressPhotoPath(path: string, releaseId: string): boolean {
  return new RegExp(`^${releaseId}/[0-9a-f-]{36}\\.(jpg|png|webp)$`, "i").test(path);
}

export type PressKit = {
  release_id: string;
  press_text: string | null;
  /** Короткоживущая ссылка на превью фото (приватный бакет). */
  photo_url: string | null;
  updated_at: string | null;
};

export function isPressKitFilled(kit: Pick<PressKit, "press_text" | "photo_url"> | null | undefined): boolean {
  return Boolean(kit?.press_text?.trim() || kit?.photo_url);
}

/** «Артист — Название — фото.jpg»: файл сразу понятно куда отправлять. */
export function buildPressPhotoFilename(artist: string | null | undefined, title: string, ext: string): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  const parts = [clean(artist ?? ""), clean(title)].filter(Boolean);
  return `${parts.length > 0 ? parts.join(" — ") : "artist"} — фото.${ext}`;
}

/** «17 окт, 14:05». */
export function formatPressKitUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

/** Повторную правку раньше этого срока админу не шлём: артист часто сохраняет несколько раз подряд. */
export const PRESS_KIT_UPDATE_NOTICE_COOLDOWN_MS = 10 * 60 * 1000;

type PressKitNoticeRow = { press_text: string | null; photo_path: string | null; updated_at?: string | null };

function isPressKitRowFilled(row: PressKitNoticeRow | null | undefined): boolean {
  return Boolean(row?.press_text?.trim() || row?.photo_path);
}

/**
 * Какое уведомление админу слать после сохранения питчинга:
 * «filled» — впервые заполнен, «updated» — правка спустя паузу, null — молчим.
 */
export function pressKitNoticeKind(
  prev: PressKitNoticeRow | null | undefined,
  next: PressKitNoticeRow,
  now: number = Date.now()
): "filled" | "updated" | null {
  if (!isPressKitRowFilled(next)) return null;
  const changed = (prev?.press_text ?? null) !== (next.press_text ?? null) || (prev?.photo_path ?? null) !== (next.photo_path ?? null);
  if (!changed) return null;
  // Пауза и для «filled»: иначе чередование «очистить → заполнить» заспамит админа.
  const prevAt = prev?.updated_at ? Date.parse(prev.updated_at) : NaN;
  if (Number.isFinite(prevAt) && now - prevAt < PRESS_KIT_UPDATE_NOTICE_COOLDOWN_MS) return null;
  return isPressKitRowFilled(prev) ? "updated" : "filled";
}
