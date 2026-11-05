import { getTelegramApiAuthHeaders, getTelegramUser, getTelegramUserDisplayName, getTelegramUserId, getTelegramUsername, getTelegramWebApp, initTelegramWebApp, isTelegramMiniApp, setRlsTelegramUserIdOverride } from "@/lib/telegram";
import { getReleaseById } from "@/repositories/releases.repo";
import type { ReleaseRecord } from "@/repositories/releases.repo";
import { useCreateReleaseDraftStore } from "../store";
import { createSupabaseBrowser } from "@/lib/supabase";
import { ReleaseApiError } from "@/lib/api/release-client";
import { stableNumericIdFromAuthUserId } from "@/lib/stable-web-user-id";

/** Таймаут коротких операций Supabase (insert/upsert в БД). Загрузка WAV идёт напрямую в Storage без лимита. */
export const SUPABASE_DB_OP_TIMEOUT_MS = 15000;


const ALIGN_RELEASES_SESSION_KEY = "tg-mini-app-align-releases-ok-v1";
let alignReleasesFetchInFlight: Promise<void> | null = null;

/** HTTP-статус последнего ответа submit-precheck (для отладки 401 на экране Review). */
let lastSubmitPrecheckHttpStatus: number | null = null;

export function getLastSubmitPrecheckHttpStatus(): number | null {
  return lastSubmitPrecheckHttpStatus;
}

function appendDetailBulletsToErrorMessage(base: string, details: unknown): string {
  if (!Array.isArray(details) || details.length === 0) return base;
  const bullets = details
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((line) => `• ${line.trim()}`);
  if (bullets.length === 0) return base;
  return `${base}\n\n${bullets.join("\n")}`;
}

/** Числовой id для API/Storage из строки стора (Telegram id). */
export function parseStoreUserId(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/**
 * Веб-сессия (email): подставляем `telegram_id` из `public.users` в стор и RLS,
 * чтобы совпадать с мастером в Mini App (тот же числовой user_id в releases/tracks).
 */
export async function syncWebUserIntoStore(): Promise<void> {
  if (typeof window === "undefined") return;
  if (getTelegramUserId()) return;

  const sb = createSupabaseBrowser();
  const {
    data: { session }
  } = await sb.auth.getSession();
  if (!session?.user) return;

  const { data: row } = await sb
    .from("users")
    .select("telegram_id")
    .eq("id", session.user.id)
    .maybeSingle();

  if (row?.telegram_id) {
    const raw = row.telegram_id as unknown;
    const tid =
      typeof raw === "bigint"
        ? Number(raw)
        : typeof raw === "number"
          ? raw
          : Number(raw);
    if (!Number.isFinite(tid) || tid <= 0) return;

    const n = Math.trunc(tid);
    initTelegramWebApp();
    const st = useCreateReleaseDraftStore.getState();
    const prev = st.userId;
    if (prev != null && prev !== String(n)) {
      st.resetDraft();
    }
    st.setUserContext({
      userId: String(n),
      telegramName: st.telegramName,
      telegramUsername: st.telegramUsername
    });
    setRlsTelegramUserIdOverride(n);
    return;
  }

  const syn = stableNumericIdFromAuthUserId(session.user.id);
  setRlsTelegramUserIdOverride(null);
  const st = useCreateReleaseDraftStore.getState();
  const prev = st.userId;
  if (prev != null && prev !== String(syn)) {
    st.resetDraft();
  }
  st.setUserContext({
    userId: String(syn),
    telegramName: st.telegramName,
    telegramUsername: st.telegramUsername
  });
}

/** Релиза нет (404 / PGRST116) или он чужой (403, например после смены аккаунта) — id в сторе устарел. */
export function isPostgrestNoSuchRowError(e: unknown): boolean {
  if (e instanceof ReleaseApiError && e.status === 403) return true;
  const code =
    typeof e === "object" && e !== null && "code" in e
      ? String((e as { code: unknown }).code)
      : "";
  return code === "PGRST116";
}

/**
 * Если в persist лежит `releaseId`, которого уже нет в БД, service routes (`save-draft-patch`,
 * `draft-upload-state`) отвечают 404 «Релиз не найден.» — сбрасываем id, дальше `ensureDraftRelease`
 * подтянет строку по `client_request_id` (upsert).
 * Сбрасываем только при PGRST116 (0 строк), не при обрыве сети.
 */
export async function verifyStoredReleaseExistsOrClearReleaseId(): Promise<void> {
  const rid = useCreateReleaseDraftStore.getState().releaseId;
  if (!rid) return;
  try {
    await getReleaseById(rid);
  } catch (e: unknown) {
    if (isPostgrestNoSuchRowError(e)) {
      // Релиз удалили (модератор) или он чужой: замечания модератора к нему больше не относятся.
      useCreateReleaseDraftStore.setState({ releaseId: null, moderatorNotes: null });
    }
  }
}

/** Заголовки Telegram / dev для API мастера создания релиза (user_id должен совпадать с владельцем в БД). */
export function getCreateReleaseApiAuthHeaders(): Record<string, string> {
  const n = parseStoreUserId(useCreateReleaseDraftStore.getState().userId);
  return getTelegramApiAuthHeaders(n != null ? { userId: n } : undefined);
}

/**
 * Финальная отправка на модерацию через `/api/releases/finalize-submit` (service role + проверка владельца).
 * Клиентского fallback нет: RLS не даёт anon-ключу менять статус релиза.
 */
export async function submitReleaseViaServiceApi(params: {
  releaseId: string;
  clientRequestId: string;
  /** Галочка с условиями на шаге «Проверка»; без неё сервер не примет отправку. */
  termsAccepted: boolean;
}): Promise<ReleaseRecord> {
  const doFetch = (authHeaders: Record<string, string>) =>
    fetch("/api/releases/finalize-submit", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders
      },
      body: JSON.stringify(params)
    });

  let authHeaders =
    typeof window !== "undefined" ? getCreateReleaseApiAuthHeaders() : {};
  let res = await doFetch(authHeaders);

  if (res.status === 401 && typeof window !== "undefined") {
    initTelegramWebApp();
    authHeaders = getCreateReleaseApiAuthHeaders();
    res = await doFetch(authHeaders);
  }

  let body: { ok?: boolean; record?: ReleaseRecord; error?: string; details?: unknown } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* ignore */
  }

  if (!res.ok || !body.ok || !body.record) {
    console.error("[submitReleaseViaServiceApi] failed", {
      status: res.status,
      body
    });
    const core =
      typeof body.error === "string" && body.error.length > 0
        ? body.error
        : "Не удалось отправить релиз на модерацию.";
    throw new Error(appendDetailBulletsToErrorMessage(core, body.details));
  }

  return body.record;
}

export async function requestReleaseSubmitPrecheck(params: {
  releaseId: string;
  clientRequestId: string;
  declaredTrackCount: number;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  lastSubmitPrecheckHttpStatus = null;
  const bodyJson = JSON.stringify({
    releaseId: params.releaseId,
    clientRequestId: params.clientRequestId,
    declaredTrackCount: params.declaredTrackCount
  });

  const fetchPrecheck = (authHeaders: Record<string, string>) =>
    fetch("/api/releases/submit-precheck", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders
      },
      body: bodyJson
    });

  let authHeaders =
    typeof window !== "undefined" ? getCreateReleaseApiAuthHeaders() : {};
  let res = await fetchPrecheck(authHeaders);

  if (res.status === 401 && typeof window !== "undefined") {
    initTelegramWebApp();
    authHeaders = getCreateReleaseApiAuthHeaders();
    res = await fetchPrecheck(authHeaders);
  }

  lastSubmitPrecheckHttpStatus = res.status;

  let body: { ok?: boolean; error?: string; details?: unknown } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* ignore */
  }

  if (!res.ok) {
    const errPayload = {
      status: res.status,
      statusText: res.statusText,
      body,
      hadInitDataHeader: Boolean(authHeaders["X-Telegram-Init-Data"]),
      hadDevUserHeader: Boolean(authHeaders["X-Dev-Telegram-User-Id"]),
      releaseId: params.releaseId
    };
    console.error("[requestReleaseSubmitPrecheck] failed", errPayload);

    const core =
      typeof body.error === "string" && body.error.length > 0
        ? body.error
        : res.status === 401
          ? "Не удалось подтвердить сессию Telegram. Откройте мини-приложение из Telegram."
          : "Не удалось проверить треки перед отправкой.";
    const msg = appendDetailBulletsToErrorMessage(core, body.details);
    return { ok: false, message: msg };
  }

  return { ok: true };
}

function uuidV4Fallback(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
}

export function createClientRequestId(existing?: string | null): string {
  if (existing) return existing;
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return uuidV4Fallback();
}

function getDevUserIdOverride(): number | null {
  if (process.env.NODE_ENV === "production") return null;
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("devUserId");
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.trunc(parsed);
  } catch {
    return null;
  }
}

function getDevUserIdDefault(): number | null {
  if (process.env.NODE_ENV === "production") return null;
  if (typeof window === "undefined") return null;
  const hasTelegram = Boolean(getTelegramWebApp()?.initDataUnsafe?.user?.id);
  if (hasTelegram) return null;
  return 1;
}

export function initUserContextInStore() {
  initTelegramWebApp();
  const devUserId = getDevUserIdOverride() ?? getDevUserIdDefault();
  const tgUser = getTelegramUser();
  const numericId = devUserId ?? getTelegramUserId() ?? null;
  const userId =
    numericId != null && Number.isFinite(numericId) && numericId > 0
      ? String(Math.trunc(numericId))
      : null;
  const telegramName = getTelegramUserDisplayName();
  const telegramUsername = getTelegramUsername();
  const store = useCreateReleaseDraftStore.getState();
  const previousUserId = store.userId;
  if (
    previousUserId != null &&
    userId != null &&
    previousUserId !== userId
  ) {
    store.resetDraft();
  }
  store.setUserContext({ userId, telegramName, telegramUsername });
  setRlsTelegramUserIdOverride(numericId != null && numericId > 0 ? Math.trunc(numericId) : null);

  if (typeof window !== "undefined" && isTelegramMiniApp()) {
    try {
      if (sessionStorage.getItem(ALIGN_RELEASES_SESSION_KEY) === "1") {
        return;
      }
    } catch {
      /* private mode / no storage */
    }
    if (alignReleasesFetchInFlight) {
      return;
    }
    const n =
      parseStoreUserId(useCreateReleaseDraftStore.getState().userId) ?? getTelegramUserId();
    alignReleasesFetchInFlight = (async () => {
      try {
        const res = await fetch("/api/identity/align-releases", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...getTelegramApiAuthHeaders(n != null && n > 0 ? { userId: n } : undefined)
          },
          body: JSON.stringify({})
        });
        if (res.ok) {
          try {
            sessionStorage.setItem(ALIGN_RELEASES_SESSION_KEY, "1");
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      } finally {
        alignReleasesFetchInFlight = null;
      }
    })();
  }
}

/** Паспорт релиза из строки `releases` (общий маппинг для hydrate и резюме черновика). */
