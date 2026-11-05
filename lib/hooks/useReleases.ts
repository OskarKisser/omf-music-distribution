"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { initUserContextInStore } from "@/features/release/createRelease/actions";
import { type ReleaseRecord } from "@/repositories/releases.repo";
import {
  getTelegramApiAuthHeaders,
  isTelegramClientShell,
  getTelegramWebApp,
  getTelegramUserIdForSupabaseRequests,
  getTelegramInitDataForApiHeader,
  initTelegramWebApp,
  type TelegramUser
} from "@/lib/telegram";
import { createSupabaseBrowser } from "@/lib/supabase";
import { USER_REQUEST_TIMEOUT_MESSAGE } from "@/lib/errors";
import { SWR_LIST_OPTIONS } from "@/lib/swr-config";
import { withRequestTimeout } from "@/lib/withRequestTimeout";
import { normalizeReleaseStatus } from "@/lib/release-status";
import type { Session } from "@supabase/supabase-js";

export type ReleaseListRow = ReleaseListBaseRow & {
  /** Когда ушёл на проверку (только для `processing`), из API. */
  submitted_at?: string | null;
};
type ReleaseListBaseRow = Pick<
  ReleaseRecord,
  | "id"
  | "title"
  | "track_name"
  | "artist_name"
  | "artwork_url"
  | "status"
  | "created_at"
  | "error_message"
  | "admin_notes"
  | "draft_upload_started"
  | "isrc"
  | "upc"
  | "release_type"
  | "smart_link"
  | "release_date"
  | "rejection_reasons"
>;

const RELEASES_LIST_TIMEOUT_MS = 15000;
const TELEGRAM_ID_POLL_INTERVAL_MS = 250;
const FALLBACK_TELEGRAM_DETECTION_POLL_MS = 250;
const DEBUG_TELEGRAM_AUTH = process.env.NODE_ENV !== "production";
const RELEASES_LOCAL_CACHE_PREFIX = "releases:list:v1";

function isValidTelegramUserId(value: string | null): value is string {
  if (value == null) return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

type ReleasesSwrKey =
  | readonly ["releases", "telegram", string]
  | readonly ["releases", "web", string];

function getSWRStorageKey(key: ReleasesSwrKey): string {
  return `${RELEASES_LOCAL_CACHE_PREFIX}:${key[1]}:${key[2]}`;
}

function readCachedReleaseRows(key: ReleasesSwrKey | null): ReleaseListRow[] | undefined {
  if (key == null || typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(getSWRStorageKey(key));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { rows?: ReleaseListRow[]; updatedAt?: number };
    if (!Array.isArray(parsed.rows)) return undefined;
    // 10 minutes local stale cache for instant warm starts.
    if (typeof parsed.updatedAt === "number" && Date.now() - parsed.updatedAt > 10 * 60_000) {
      return undefined;
    }
    return parsed.rows;
  } catch {
    return undefined;
  }
}

function writeCachedReleaseRows(key: ReleasesSwrKey | null, rows: ReleaseListRow[] | undefined): void {
  if (key == null || typeof window === "undefined" || !Array.isArray(rows)) return;
  try {
    window.localStorage.setItem(
      getSWRStorageKey(key),
      JSON.stringify({ rows, updatedAt: Date.now() })
    );
  } catch {
    // ignore quota/private mode errors
  }
}

async function buildTelegramRequestHeaders(uidCandidate?: number): Promise<Record<string, string>> {
  const uid =
    Number.isFinite(uidCandidate ?? NaN) && (uidCandidate ?? 0) > 0
      ? Math.trunc(uidCandidate as number)
      : getTelegramUserIdForSupabaseRequests();
  // X-Telegram-Init-Data уже есть в baseHeaders. Второй ключ с другим регистром fetch склеивает
  // в «значение, значение», и подпись initData на сервере не проходит.
  const baseHeaders = getTelegramApiAuthHeaders(uid != null ? { userId: uid } : undefined);
  return {
    ...(uid != null && uid > 0 ? { "x-telegram-user-id": String(uid) } : {}),
    ...baseHeaders
  };
}

async function fetchReleasesTelegram([, , uid]: readonly ["releases", "telegram", string]): Promise<
  ReleaseListRow[]
> {
  const numericUid = Number(uid);

  const run = async () => {
    const telegramHeaders = await buildTelegramRequestHeaders(numericUid);
    const res = await fetch("/api/releases/my", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...telegramHeaders
      },
      cache: "no-store"
    });
    const json = (await res.json()) as { ok?: boolean; rows?: ReleaseListRow[]; error?: string };
    // Без прямого fallback в Supabase: RLS не доверяет x-telegram-user-id, источник — только API.
    if (!res.ok || json.ok !== true || !Array.isArray(json.rows)) {
      throw new Error(json.error || "Не удалось загрузить релизы.");
    }
    return json.rows;
  };
  return withRequestTimeout(run(), RELEASES_LIST_TIMEOUT_MS, USER_REQUEST_TIMEOUT_MESSAGE);
}

async function fetchReleasesWeb([, , _authUid]: readonly ["releases", "web", string]): Promise<
  ReleaseListRow[]
> {
  const run = async () => {
    const parsedAuthUid = Number(_authUid);
    const telegramHeaders = await buildTelegramRequestHeaders(
      Number.isFinite(parsedAuthUid) && parsedAuthUid > 0 ? Math.trunc(parsedAuthUid) : undefined
    );
    const res = await fetch("/api/releases/my", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json", ...telegramHeaders },
      cache: "no-store"
    });
    const json = (await res.json()) as { ok?: boolean; rows?: ReleaseListRow[]; error?: string };
    if (!res.ok || json.ok !== true || !Array.isArray(json.rows)) {
      throw new Error(json.error || "Не удалось загрузить релизы.");
    }
    return json.rows;
  };
  return withRequestTimeout(run(), RELEASES_LIST_TIMEOUT_MS, USER_REQUEST_TIMEOUT_MESSAGE);
}

async function fetchReleases(key: ReleasesSwrKey): Promise<ReleaseListRow[]> {
  if (key[1] === "telegram") {
    return fetchReleasesTelegram(key);
  }
  return fetchReleasesWeb(key);
}

/**
 * Library list: Telegram — по telegram id + anon/заголовок; Web — по JWT и RLS.
 */
export function useReleases() {
  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  /** telegram | web — откуда взяли userId для SWR */
  const [authMode, setAuthMode] = useState<"telegram" | "web" | null>(null);
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [greetingName, setGreetingName] = useState<string>("Артист");
  const [hasResolvedInitialFetch, setHasResolvedInitialFetch] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let telegramModeLocked = false;
    if (DEBUG_TELEGRAM_AUTH) {
      console.log("[TG-DEBUG] useEffect start", {
        isTelegramClientShell: isTelegramClientShell(),
        tidNow: getTelegramUserIdForSupabaseRequests()
      });
    }
    initTelegramWebApp();
    initUserContextInStore();

    const applyTelegramMode = (tid: number | null) => {
      if (DEBUG_TELEGRAM_AUTH) {
        console.log("[TG-DEBUG] applyTelegramMode", { tid });
      }
      if (cancelled) return;
      if (tid != null) {
        telegramModeLocked = true;
      }
      setUser((prev) => getTelegramWebApp()?.initDataUnsafe?.user ?? prev ?? null);
      setUserId(tid != null ? String(tid) : null);
      setAuthMode("telegram");
      const tg = getTelegramWebApp()?.initDataUnsafe?.user;
      setGreetingName((prev) => tg?.first_name?.trim() || tg?.username?.trim() || prev || "Артист");
      setAuthReady(tid != null);
    };

    const tidNow = getTelegramUserIdForSupabaseRequests();
    if (tidNow != null) {
      applyTelegramMode(tidNow);
      return () => {
        cancelled = true;
      };
    }
    if (isTelegramClientShell()) {
      initTelegramWebApp(); // ensure cookie is set before SWR fires
      const poll = window.setInterval(() => {
        if (cancelled) {
          window.clearInterval(poll);
          return;
        }
        initTelegramWebApp(); // ensure cookie is set before SWR fires
        const tid = getTelegramUserIdForSupabaseRequests();
        if (DEBUG_TELEGRAM_AUTH) {
          console.log("[TG-DEBUG] poll tick", { tid });
        }

        if (tid != null) {
          window.clearInterval(poll);
          applyTelegramMode(tid);
        }
      }, TELEGRAM_ID_POLL_INTERVAL_MS);

      return () => {
        cancelled = true;
        window.clearInterval(poll);
      };
    }

    const supabase = createSupabaseBrowser();

    const applySession = (session: Session | null) => {
      if (cancelled) return;
      if (telegramModeLocked || isTelegramClientShell()) {
        const tid = getTelegramUserIdForSupabaseRequests();
        applyTelegramMode(tid ?? null);
        return;
      }
      const tgInitData = getTelegramInitDataForApiHeader();
      if (tgInitData.length > 0) {
        const tid = getTelegramUserIdForSupabaseRequests();
        if (tid != null) {
          applyTelegramMode(tid);
        } else {
          // Telegram context is present but user id is not resolved yet: don't fall back to web actor.
          setAuthMode("telegram");
          setAuthReady(false);
        }
        return;
      }
      const tid = getTelegramUserIdForSupabaseRequests();
      if (tid != null) {
        applyTelegramMode(tid);
        return;
      }
      if (session?.user) {
        setUserId(session.user.id);
        setAuthMode("web");
        const meta = session.user.user_metadata as { display_name?: string | null };
        const email = session.user.email;
        const name =
          meta?.display_name?.trim() ||
          email?.split("@")[0]?.trim() ||
          "Артист";
        setGreetingName(name);
      } else {
        if (telegramModeLocked) return;
        setUserId(null);
        setAuthMode(null);
        setGreetingName((prev) => prev || "Артист");
      }
      setAuthReady(true);
    };

    void supabase.auth.getSession().then(({ data: { session } }) => {
      applySession(session);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    const poll = window.setInterval(() => {
      if (cancelled) return;
      const tid = getTelegramUserIdForSupabaseRequests();
      if (tid != null) {
        window.clearInterval(poll);
        applyTelegramMode(tid);
        return;
      }
      if (isTelegramClientShell()) {
        applyTelegramMode(null);
      }
    }, FALLBACK_TELEGRAM_DETECTION_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      subscription.unsubscribe();
    };
  }, []);

  const swrKey: ReleasesSwrKey | null = useMemo(() => {
    if (DEBUG_TELEGRAM_AUTH) {
      console.log("[TG-DEBUG] swrKey computed", { authReady, userId, authMode });
    }
    if (!authReady || userId == null || authMode == null) return null;
    if (authMode === "telegram" && !isValidTelegramUserId(userId)) {
      return null;
    }
    if (authMode === "telegram") {
      return ["releases", "telegram", userId];
    }
    return ["releases", "web", userId];
  }, [authReady, userId, authMode]);

  const fallbackRows = useMemo(() => readCachedReleaseRows(swrKey), [swrKey]);

  const swr = useSWR(swrKey, fetchReleases, {
    ...SWR_LIST_OPTIONS,
    revalidateOnFocus: true,
    refreshInterval: (latestData: ReleaseListRow[] | undefined) =>
      latestData?.some((r) => normalizeReleaseStatus(r.status) === "processing") ? 7000 : 0,
    keepPreviousData: true,
    fallbackData: fallbackRows
  });

  useEffect(() => {
    writeCachedReleaseRows(swrKey, swr.data);
  }, [swrKey, swr.data]);

  /**
   * "Первичная загрузка завершена" = получили данные или ошибку для активного ключа.
   * Пока нет этого флага, UI должен показывать skeleton, а не empty-state.
   */
  useEffect(() => {
    if (swrKey == null) {
      setHasResolvedInitialFetch(false);
      return;
    }
    if (swr.data !== undefined || swr.error != null || (!swr.isLoading && !swr.isValidating)) {
      setHasResolvedInitialFetch(true);
    }
  }, [swrKey, swr.data, swr.error, swr.isLoading, swr.isValidating]);

  const releases = useMemo(() => swr.data ?? [], [swr.data]);

  const releaseStats = useMemo(() => {
    return releases.reduce(
      (acc, release) => {
        const status = normalizeReleaseStatus(release.status);
        if (status === "ready") acc.ready += 1;
        else if (status === "processing") acc.processing += 1;
        else if (status === "failed") acc.failed += 1;
        return acc;
      },
      { ready: 0, processing: 0, failed: 0 }
    );
  }, [releases]);

  const waitingForTelegramIdentity =
    authMode === "telegram" && !isValidTelegramUserId(userId);
  const isBootstrapping =
    !authReady ||
    waitingForTelegramIdentity ||
    (swrKey != null &&
      !hasResolvedInitialFetch &&
      (swr.isLoading || swr.isValidating || (swr.data === undefined && swr.error == null)));

  if (DEBUG_TELEGRAM_AUTH) {
    console.log("[TG-DEBUG] useReleases return", {
      authReady,
      userId,
      swrKey,
      isLoading: swr.isLoading,
      isValidating: swr.isValidating,
      dataLength: swr.data?.length ?? "undefined",
      error: swr.error
    });
  }

  return {
    userId,
    authReady,
    authMode,
    isBootstrapping,
    telegramUser: user,
    greetingName,
    releases,
    releaseStats,
    ...swr,
    isLoading: isBootstrapping
  };
}
