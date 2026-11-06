import { getTelegramApiAuthHeaders, getTelegramUserId } from "./telegram";
import { createSupabaseBrowser } from "./supabase";

function parsePositiveTelegramId(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

/**
 * Сравнение Telegram ID без сюрпризов от типов (number vs string из заголовков / env).
 */
export function telegramIdsEqual(a: number, b: number): boolean {
  return String(a) === String(b);
}

/**
 * Сырой ID админа из env. На сервере доступны обе переменные; в браузерном бандле Next
 * подставляется только `NEXT_PUBLIC_*`, поэтому для UI в production нужен
 * `NEXT_PUBLIC_ADMIN_TELEGRAM_ID` (тот же числовой ID, что и `ADMIN_TELEGRAM_ID`).
 */
function readAdminTelegramIdRawForServer(): string {
  return (
    process.env.ADMIN_TELEGRAM_ID?.trim() ||
    process.env.NEXT_PUBLIC_ADMIN_TELEGRAM_ID?.trim() ||
    ""
  );
}

/**
 * ID админа для клиентского UI (вкладка «Админ», редирект startapp=admin).
 * В браузере сначала `NEXT_PUBLIC_ADMIN_TELEGRAM_ID`, иначе сравнение с env невозможно.
 */
export function getAdminTelegramIdForUi(): number | null {
  if (typeof window === "undefined") {
    return parsePositiveTelegramId(readAdminTelegramIdRawForServer());
  }
  const raw =
    process.env.NEXT_PUBLIC_ADMIN_TELEGRAM_ID?.trim() ||
    process.env.ADMIN_TELEGRAM_ID?.trim() ||
    "";
  return parsePositiveTelegramId(raw);
}

/**
 * Числовой Telegram ID администратора для серверных API (строго: должно быть задано в env).
 * Принимает `ADMIN_TELEGRAM_ID` или, как запасной вариант, `NEXT_PUBLIC_ADMIN_TELEGRAM_ID`
 * (одинаковое значение на Vercel).
 */
export function getExpectedAdminTelegramId(): number {
  const raw = readAdminTelegramIdRawForServer();
  if (!raw) {
    throw new Error(
      "[admin] Set ADMIN_TELEGRAM_ID (and for client Admin UI also NEXT_PUBLIC_ADMIN_TELEGRAM_ID) " +
        "to the admin Telegram numeric ID."
    );
  }
  const parsed = parsePositiveTelegramId(raw);
  if (parsed === null) {
    throw new Error(`[admin] Admin Telegram ID "${raw}" is not a valid positive integer.`);
  }
  return parsed;
}

/**
 * Показ вкладки «Админ» и клиентских проверок доступа.
 * В `development` на localhost — всегда true для удобства.
 * В production — сравнение ID через строки; env для браузера: `NEXT_PUBLIC_ADMIN_TELEGRAM_ID`.
 */
export function isAdminUi(): boolean {
  if (process.env.NODE_ENV === "development") {
    return true;
  }
  const uid = getTelegramUserId();
  if (uid === null) return false;
  const adminId = getAdminTelegramIdForUi();
  if (adminId === null) return false;
  return telegramIdsEqual(uid, adminId);
}

/** Роль веб-пользователя на сеанс вкладки: админские экраны не ждут запроса к базе при каждом переходе. */
let webAdminKnown: { uid: string; value: boolean } | null = null;

/** Уже знаем, что веб-пользователь — админ: экран можно показывать сразу, проверка догонит. */
export function peekWebAdminUi(): boolean {
  return typeof window !== "undefined" && webAdminKnown?.value === true;
}

export function forgetWebAdmin(): void {
  webAdminKnown = null;
}

export async function isAdminUiByWebSession(): Promise<boolean> {
  try {
    const supabase = createSupabaseBrowser();
    const {
      data: { session }
    } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      webAdminKnown = null;
      return false;
    }
    if (webAdminKnown?.uid === session.user.id) return webAdminKnown.value;
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", session.user.id)
      .maybeSingle();
    if (error || !data) return false;
    const value = String((data as { role?: string | null }).role ?? "").trim().toLowerCase() === "admin";
    webAdminKnown = { uid: session.user.id, value };
    return value;
  } catch {
    return false;
  }
}

/**
 * Заголовки для админских API (`withTelegramAuth` + проверка admin ID).
 * В `next dev` в обычном браузере без Mini App подставляется `X-Dev-Telegram-User-Id`
 * из `NEXT_PUBLIC_ADMIN_TELEGRAM_ID`, иначе по умолчанию уходит `1` и сервер отвечает 403.
 */
export function getTelegramApiAuthHeadersForAdminApi(): Record<string, string> {
  const uid = getTelegramUserId();
  if (uid != null) {
    return getTelegramApiAuthHeaders();
  }
  const adminId = getAdminTelegramIdForUi();
  if (process.env.NODE_ENV === "development" && adminId != null) {
    return getTelegramApiAuthHeaders({ userId: adminId });
  }
  return getTelegramApiAuthHeaders();
}

export async function getAdminApiAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    ...getTelegramApiAuthHeadersForAdminApi()
  };
  try {
    const supabase = createSupabaseBrowser();
    const {
      data: { session }
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }
  } catch {
    // no-op
  }
  return headers;
}
