/**
 * Состояния карточек (chat_data) и ответы на их запросы. Предел Telegram — 1024 байта UTF-8,
 * кириллица — 2 байта на букву: короткие массивы вместо объектов, названия обрезаем,
 * длинные списки режем `fitRows` и показываем страницами.
 * Форматы совпадают с кодом карточек в mockups/*-widget.html.
 */
import { getReleaseNextStep, type NextStepKind } from "@/lib/release-next-step";
import type { PlatformIssue } from "@/lib/platform-issue";

export const STATE_LIMIT = 1024;
/** Строк на странице: 4 строки + шапка + плитки держат карточку ниже 600 px. */
export const PAGE_SIZE = 4;

export function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/** Сколько первых строк влезает в предел, если собрать из них ответ `build`. */
export function fitRows<T>(build: (rows: T[]) => string, rows: T[], limit = STATE_LIMIT): number {
  let n = rows.length;
  while (n > 0 && utf8Bytes(build(rows.slice(0, n))) > limit) n--;
  return n;
}

export function short(s: string, max: number): string {
  const chars = [...s.trim()];
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("");
}

/** Время по Москве в минутах от полуночи — для «обновлено 14:37» в шапке. */
export function moscowMinutes(now: Date): number {
  const [h, m] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  })
    .format(now)
    .split(":")
    .map(Number);
  return h * 60 + m;
}

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "нояб", "дек"];

/** «2026-11-20…» → «20 нояб»; иначе пусто. */
export function shortReleaseDate(raw: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? "").trim());
  if (!m) return "";
  const month = MONTHS_SHORT[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month}` : "";
}

// ─── Мои релизы (артист) ─────────────────────────────────────────────────────

/** Индекс следующего шага — по нему карточка выбирает подпись и цвет (массивы L и T в коде карточки). */
export const KIND_CODE: Record<NextStepKind, number> = {
  finish_draft: 0,
  submit: 1,
  fix: 2,
  waiting: 3,
  waiting_long: 4,
  approved_link: 5,
  approved_no_link: 6,
  updating: 7,
  removed: 8,
  unknown: 9
};

export type ArtistRelease = {
  id: string;
  title: string;
  artist: string;
  type: string;
  status: string | null;
  smartLink: string | null;
  releaseDate: string | null;
  submittedAt: string | null;
  platformIssue: PlatformIssue | null;
};

export type ReleaseItem = {
  release: ArtistRelease;
  k: number;
  /** Часы на проверке — только для «На проверке N ч». */
  h: number | null;
  title: string;
  body: string;
};

export function releaseItem(r: ArtistRelease, now: Date): ReleaseItem {
  const step = getReleaseNextStep(
    {
      status: r.status,
      smartLink: r.smartLink,
      submittedAt: r.submittedAt,
      notifiesInTelegram: true,
      platformIssue: r.platformIssue
    },
    now
  );
  const k = KIND_CODE[step.kind];
  let h: number | null = null;
  if (k === 3 && r.submittedAt) {
    const t = new Date(r.submittedAt).getTime();
    if (!Number.isNaN(t)) h = Math.max(0, Math.floor((now.getTime() - t) / 36e5));
  }
  return { release: r, k, h, title: step.title, body: step.body };
}

export type ReleasesFilter = "a" | "m" | "d";

export function matchesFilter(item: ReleaseItem, f: ReleasesFilter): boolean {
  if (f === "m") return item.k <= 2;
  if (f === "d") return item.k === 5 || item.k === 6;
  return true;
}

type ReleaseRow = [string, string, number, number | null];

function releaseRow(it: ReleaseItem): ReleaseRow {
  return [it.release.id.slice(0, 8), short(it.release.title || "Без названия", 40), it.k, it.h];
}

function pageOf<T, R>(items: T[], off: number, toRow: (x: T) => R, head: (rows: R[]) => unknown[]): R[] {
  const rows = items.slice(off, off + PAGE_SIZE).map(toRow);
  return rows.slice(0, fitRows((rs) => JSON.stringify(head(rs)), rows));
}

/** Ближайший выход: принятый релиз с датой не раньше сегодняшней (по Москве). */
function nextRelease(items: ReleaseItem[], todayIso: string): [string, string] | 0 {
  const upcoming = items
    .filter((it) => it.k >= 5 && it.k <= 7 && (it.release.releaseDate ?? "").slice(0, 10) >= todayIso)
    .sort((a, b) => String(a.release.releaseDate).localeCompare(String(b.release.releaseDate)))[0];
  return upcoming ? [shortReleaseDate(upcoming.release.releaseDate), short(upcoming.release.title, 28)] : 0;
}

export type WidgetState = {
  /** chat_data для Telegram. */
  data: string;
  /** То же без времени обновления: правим карточку, только если ключ изменился. */
  key: string;
  caption: string;
};

const RELEASE_WORD: [string, string, string] = ["релиз", "релиза", "релизов"];

function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

export function moscowTodayIso(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(now);
}

/** `[всего, вернули, не отправлено, ссылок, ближайший|0, минуты, строки первой страницы]`. */
export function buildReleasesState(items: ReleaseItem[], now: Date): WidgetState {
  const fx = items.filter((i) => i.k === 2).length;
  const un = items.filter((i) => i.k <= 1).length;
  const lk = items.filter((i) => i.k === 5).length;
  const nx = nextRelease(items, moscowTodayIso(now));
  const head = (rows: ReleaseRow[]) => [items.length, fx, un, lk, nx, moscowMinutes(now), rows];
  const rows = pageOf(items, 0, releaseRow, head);
  const full = head(rows);
  const key = JSON.stringify([full[0], full[1], full[2], full[3], full[4], full[6]]);
  return { data: JSON.stringify(full), key, caption: releasesCaption(items) };
}

/** Подпись: её видно в списке чатов и на компьютере, где карточек пока нет. */
export function releasesCaption(items: ReleaseItem[]): string {
  if (items.length === 0) return "Мои релизы — пока пусто. Загрузи первый релиз в приложении.";
  const first = items.find((i) => i.k <= 4) ?? items[0];
  const step = first.k === 3 && first.h != null ? `на проверке ${first.h < 1 ? "меньше часа" : first.h < 24 ? `${first.h} ч` : `${Math.floor(first.h / 24)} дн`}` : first.title.toLowerCase();
  return `Мои релизы (${items.length} ${plural(items.length, RELEASE_WORD)}): «${short(first.release.title || "Без названия", 40)}» — ${step}. Открой карточку в Telegram на телефоне.`;
}

/** Ответ на `r:p:<фильтр>:<смещение>`: `[смещение, всего, строки]`. */
export function releasesPage(items: ReleaseItem[], f: ReleasesFilter, off: number): string {
  const list = items.filter((i) => matchesFilter(i, f));
  const o = Math.max(0, Math.min(off, list.length));
  const head = (rows: ReleaseRow[]) => [o, list.length, rows];
  return JSON.stringify(head(pageOf(list, o, releaseRow, head)));
}

/** Ответ на `r:d:<id8>`: экран релиза. Длинное пояснение укорачиваем до предела. */
export function releaseDetail(it: ReleaseItem): string {
  const r = it.release;
  const build = (body: string) =>
    JSON.stringify([
      r.id,
      short(r.title || "Без названия", 60),
      short(r.artist || "—", 40),
      r.type,
      it.k,
      it.h,
      shortReleaseDate(r.releaseDate),
      it.title,
      body
    ]);
  let body = it.body;
  while (utf8Bytes(build(body)) > STATE_LIMIT && body.length > 20) body = short(body, Math.floor([...body].length * 0.8));
  return build(body);
}

// ─── Пульт (админ) ───────────────────────────────────────────────────────────

export type QueueItem = { id: string; title: string; artist: string; waitMin: number };
export type PaymentItem = { id: string; title: string; artist: string; discountRub: number };

/**
 * Ожидание огрубляем до того, что показывает карточка (15 мин / часы / дни):
 * иначе состояние менялось бы каждую минуту и Telegram получал бы лишние правки.
 */
export function coarseWait(min: number): number {
  const m = Math.max(0, Math.floor(min));
  if (m < 60) return Math.floor(m / 15) * 15;
  if (m < 1440) return Math.floor(m / 60) * 60;
  return Math.floor(m / 1440) * 1440;
}

type QueueRow = [string, string, string, number];
type PaymentRow = [string, string, string, number];

const queueRow = (q: QueueItem): QueueRow => [q.id, short(q.title || "Без названия", 32), short(q.artist || "—", 24), coarseWait(q.waitMin)];
const paymentRow = (p: PaymentItem): PaymentRow => [p.id, short(p.title || "Без названия", 32), short(p.artist || "—", 24), p.discountRub];

function waitText(min: number): string {
  const m = coarseWait(min);
  return m < 60 ? `${m} мин` : m < 1440 ? `${m / 60} ч` : `${m / 1440} дн`;
}

/** `[в очереди, дольше всех (мин), оплата не отмечена, новых за сутки, минуты, строки очереди]`. Очередь — самые старые сверху. */
export function buildTodayState(
  queue: QueueItem[],
  unpaid: number,
  new24h: number,
  now: Date
): WidgetState {
  const sorted = [...queue].sort((a, b) => b.waitMin - a.waitMin);
  const oldest = sorted[0] ? coarseWait(sorted[0].waitMin) : 0;
  const head = (rows: QueueRow[]) => [sorted.length, oldest, unpaid, new24h, moscowMinutes(now), rows];
  const rows = pageOf(sorted, 0, queueRow, head);
  const full = head(rows);
  const key = JSON.stringify([full[0], full[1], full[2], full[3], full[5]]);
  return { data: JSON.stringify(full), key, caption: todayCaption(sorted, unpaid) };
}

export function todayCaption(sorted: QueueItem[], unpaid: number): string {
  if (sorted.length === 0 && unpaid === 0) return "Пульт: очередь пуста, оплаты отмечены.";
  const q = sorted.length
    ? `на проверке ${sorted.length}, дольше всех «${short(sorted[0].title || "Без названия", 30)}» (${waitText(sorted[0].waitMin)})`
    : "очередь пуста";
  return `Пульт: ${q}; оплата не отмечена — ${unpaid}.`;
}

/** Ответ на `a:q:<смещение>`. */
export function queuePage(queue: QueueItem[], off: number): string {
  const sorted = [...queue].sort((a, b) => b.waitMin - a.waitMin);
  const o = Math.max(0, Math.min(off, sorted.length));
  const head = (rows: QueueRow[]) => [o, sorted.length, rows];
  return JSON.stringify(head(pageOf(sorted, o, queueRow, head)));
}

/** Ответ на `a:m:<смещение>`: страница уже выбрана из базы, `total` — сколько всего. */
export function paymentPage(page: PaymentItem[], off: number, total: number): string {
  const head = (rows: PaymentRow[]) => [off, total, rows];
  return JSON.stringify(head(pageOf(page, 0, paymentRow, head)));
}

/** Ответ на отметку оплаты: `[сообщение, осталось без отметки, смещение, всего, строки]`. */
export function paymentDone(message: string, page: PaymentItem[], total: number): string {
  const head = (rows: PaymentRow[]) => [message, total, 0, total, rows];
  return JSON.stringify(head(pageOf(page, 0, paymentRow, head)));
}
