"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PullRefreshBrand } from "@/components/PullRefreshBrand";
import { ReleaseRow } from "@/components/library/ReleaseRow";
import { ReferralInviteLink } from "@/components/ReferralCard";
import { ReferralWelcome, useReferralDiscountPending } from "@/components/ReferralWelcome";
import { FirstReleaseEmpty } from "@/components/library/FirstReleaseEmpty";
import { LibraryReleaseSkeletonGrid } from "@/components/ui/LibrarySkeleton";
import { reopenRejectedRelease, resumeDraftFromRelease } from "@/features/release/createRelease/actions";
import { prepareNewReleaseDraft, useCreateReleaseDraftStore } from "@/features/release/createRelease/store";
import { normalizeReleaseStatus } from "@/lib/release-status";
import { getReleaseDisplayTitle } from "@/repositories/releases.repo";
import { useReleases, type ReleaseListRow } from "@/lib/hooks/useReleases";
import { isUnseenDecision, markStatusSeen, readSeenStatuses } from "@/lib/seen-release-status";
import { hapticMap } from "@/lib/haptic-map";
import { toast } from "sonner";
import { AuthGuard } from "@/components/AuthGuard";
import { useIsTelegramMiniApp } from "@/lib/hooks/useIsTelegramMiniApp";
import { pickProfileGreetingName, useAuthProfile } from "@/lib/hooks/useAuthProfile";
import { cn } from "@/lib/utils";
import { pickHeroArtistName } from "@/lib/artist-name";
import { RejectionNotice } from "@/components/RejectionNotice";
import { getReleaseNextStep, NEXT_STEP_TONE_CLASS, pluralRu } from "@/lib/release-next-step";
import { releaseTypeLabel } from "@/lib/release-type-label";
import { ReleaseSleeve } from "@/components/ReleaseSleeve";
import { describeRejection, type RejectionSummary } from "@/lib/rejection-reasons";
import { getTelegramInitDataForApiHeader, getTelegramUserIdForSupabaseRequests } from "@/lib/telegram";
import { FullScreenLoader } from "@/components/FullScreenLoader";


type LibraryStatusFilter = "all" | "processing" | "ready" | "failed" | "draft";
type LibraryView = "all" | "drafts" | "moderation";

/** Фильтр по статусу нужен, когда релизов много; на коротком списке статус и так виден у каждой строки. */
const STATUS_FILTER_MIN_RELEASES = 5;

const STATUS_FILTER_CHIPS: { id: LibraryStatusFilter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "processing", label: "На проверке" },
  { id: "ready", label: "Приняты" },
  { id: "failed", label: "Вернули" },
  { id: "draft", label: "Черновики" }
];

/** Черновик и «не отправлен» — один фильтр: артисту в обоих случаях надо дописать и отправить. */
function matchesStatusFilter(status: string | null | undefined, filter: LibraryStatusFilter): boolean {
  if (filter === "all") return true;
  const s = normalizeReleaseStatus(status);
  if (filter === "draft") return s === "draft" || s === "pending";
  return s === filter;
}

function parseLibraryView(value: string | null): LibraryView {
  if (value === "drafts" || value === "moderation") return value;
  return "all";
}

function LibraryPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isTelegram = useIsTelegramMiniApp();
  const {
    userId,
    authReady,
    authMode,
    telegramUser: user,
    greetingName,
    releases,
    data,
    error,
    isLoading,
    isValidating,
    mutate
  } = useReleases();

  const { data: authProfile } = useAuthProfile(
    Boolean(authReady && authMode === "web"),
    authMode === "web" ? userId : null
  );

  const isWeb = !isTelegram;
  const referralDiscountPending = useReferralDiscountPending();

  const [resumingId, setResumingId] = useState<string | null>(null);
  /** Версия локального хранилища «просмотрено» — пересчитываем метки «Новое» после открытия релиза. */
  const [seenVersion, setSeenVersion] = useState(0);
  const [statusFilter, setStatusFilter] = useState<LibraryStatusFilter>("all");
  const didRetryInitialEmptyRef = useRef(false);
  const didRetryStuckInitialLoadRef = useRef(false);
  const didHardReloadRef = useRef(false);
  const [telegramInitialEmptyRetries, setTelegramInitialEmptyRetries] = useState(0);
  const [adminNotesModal, setAdminNotesModal] = useState<{
    id: string;
    title: string;
    summary: RejectionSummary;
  } | null>(null);
  const selectedView = parseLibraryView(searchParams.get("view"));

  useEffect(() => {
    if (searchParams.get("fromCreate") !== "1") return;
    void mutate(undefined, { revalidate: true });
    router.replace("/library");
  }, [searchParams, mutate, router]);

  /** После отправки релиза / входа на экран — перезапрос списка (SWR + RLS user id из стора). */
  useEffect(() => {
    if (!authReady || userId == null) return;
    void mutate(undefined, { revalidate: true });
  }, [authReady, userId, mutate]);

  /**
   * На "холодном" заходе без кэша сессия/headers могут синхронизироваться
   * чуть позже первого запроса. Делаем один безопасный автоповтор.
   */
  useEffect(() => {
    if (!authReady || userId == null) return;
    if (isLoading || isValidating) return;
    if (error != null) return;
    if (releases.length > 0) {
      didRetryInitialEmptyRef.current = false;
      return;
    }
    if (didRetryInitialEmptyRef.current) return;
    didRetryInitialEmptyRef.current = true;
    void mutate(undefined, { revalidate: true });
  }, [authReady, userId, isLoading, isValidating, error, releases.length, mutate]);

  /**
   * Если первичная загрузка "залипла", делаем один автоматический повтор.
   * Это покрывает кейс, когда первый запрос стартует слишком рано и не завершает SWR-цикл.
   */
  useEffect(() => {
    if (!authReady || userId == null) return;
    const waitingForFirstData = (data === undefined && error == null) || (isLoading || isValidating);
    if (!waitingForFirstData) {
      didRetryStuckInitialLoadRef.current = false;
      return;
    }
    if (didRetryStuckInitialLoadRef.current) return;
    didRetryStuckInitialLoadRef.current = true;
    const t = window.setTimeout(() => {
      void mutate(undefined, { revalidate: true });
    }, 5000);
    return () => {
      window.clearTimeout(t);
    };
  }, [authReady, userId, data, error, isLoading, isValidating, mutate]);

  /**
   * На iOS Telegram иногда первый ответ приходит пустым, а следующий (как при ручном refresh) уже с релизами.
   * Перед показом empty-state делаем до 3 быстрых авто-повторов только в Telegram.
   */
  useEffect(() => {
    if (!isTelegram) return;
    if (!authReady || userId == null || authMode !== "telegram") return;
    if (isLoading || isValidating) return;
    if (error != null) return;
    if (releases.length > 0) {
      if (telegramInitialEmptyRetries !== 0) setTelegramInitialEmptyRetries(0);
      return;
    }
    if (telegramInitialEmptyRetries >= 3) return;

    const t = window.setTimeout(() => {
      setTelegramInitialEmptyRetries((n) => n + 1);
      void mutate(undefined, { revalidate: true });
    }, 400);

    return () => window.clearTimeout(t);
  }, [
    isTelegram,
    authReady,
    userId,
    authMode,
    isLoading,
    isValidating,
    error,
    releases.length,
    mutate,
    telegramInitialEmptyRetries
  ]);

  /**
   * Telegram WebView иногда "подвисает" на первом SWR-цикле, но обычный refresh сразу лечит экран.
   * Делаем ровно один auto-refresh на холодном старте, чтобы не заставлять пользователя обновлять вручную.
   */
  useEffect(() => {
    if (!isTelegram) return;
    if (!authReady || userId == null || authMode !== "telegram") return;
    if (didHardReloadRef.current) return;
    const waitingForFirstData = (data === undefined && error == null) || isLoading || isValidating;
    if (!waitingForFirstData) return;

    let timer: number | null = window.setTimeout(() => {
      if (didHardReloadRef.current) return;
      try {
        const key = "__library_first_load_hard_reload_done";
        if (sessionStorage.getItem(key) === "1") return;
        sessionStorage.setItem(key, "1");
      } catch {
        // ignore
      }
      didHardReloadRef.current = true;
      window.location.reload();
    }, 9000);

    return () => {
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [isTelegram, authReady, userId, authMode, data, error, isLoading, isValidating]);

  const viewFilteredReleases = useMemo(() => {
    if (selectedView === "drafts") {
      return releases.filter((r) => {
        const status = normalizeReleaseStatus(r.status);
        return status === "draft" || status === "pending";
      });
    }
    if (selectedView === "moderation") {
      return releases.filter((r) => normalizeReleaseStatus(r.status) === "processing");
    }
    return releases;
  }, [releases, selectedView]);

  const filteredReleases = useMemo(() => {
    if (selectedView !== "all") return viewFilteredReleases;
    if (statusFilter === "all") return viewFilteredReleases;
    return viewFilteredReleases.filter((r) => matchesStatusFilter(r.status, statusFilter));
  }, [viewFilteredReleases, selectedView, statusFilter]);

  const statusCounts = useMemo(() => {
    const out = {} as Record<LibraryStatusFilter, number>;
    for (const chip of STATUS_FILTER_CHIPS) {
      out[chip.id] = releases.filter((r) => matchesStatusFilter(r.status, chip.id)).length;
    }
    return out;
  }, [releases]);

  /** Вернули на доработку — первым делом наверху, а не где-то в списке. */
  const returnedReleases = useMemo(
    () => releases.filter((r) => normalizeReleaseStatus(r.status) === "failed"),
    [releases]
  );

  const handleCreate = useCallback(() => {
    hapticMap.impactLight();
    prepareNewReleaseDraft();
    router.push("/create/metadata");
  }, [router]);

  const handleResumeDraft = useCallback(
    async (release: ReleaseListRow) => {
      hapticMap.impactLight();
      setResumingId(release.id);
      try {
        const path = await resumeDraftFromRelease(release.id);
        if (!path) {
          const msg =
            useCreateReleaseDraftStore.getState().submitError ?? "Не удалось открыть черновик.";
          toast.error(msg);
          return;
        }
        router.push(path);
      } finally {
        setResumingId(null);
      }
    },
    [router]
  );

  const handleFixRejected = useCallback(
    async (releaseId: string) => {
      hapticMap.impactLight();
      setResumingId(releaseId);
      try {
        const path = await reopenRejectedRelease(releaseId);
        if (!path) {
          toast.error(
            useCreateReleaseDraftStore.getState().submitError ?? "Не удалось открыть релиз для правок."
          );
          return;
        }
        setAdminNotesModal(null);
        void mutate(undefined, { revalidate: true });
        router.push(path);
      } finally {
        setResumingId(null);
      }
    },
    [mutate, router]
  );

  const seenStatuses = useMemo(
    () => readSeenStatuses(releases.map((r) => r.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [releases, seenVersion]
  );

  const hasReleases = releases.length > 0;
  const hasReleasesInView = viewFilteredReleases.length > 0;
  const telegramIdentityReady =
    !isTelegram ||
    authMode !== "telegram" ||
    userId != null ||
    getTelegramUserIdForSupabaseRequests() != null ||
    getTelegramInitDataForApiHeader().length > 0;
  /** Нет контекста пользователя (сессия / Telegram) или ещё не инициализировали */
  const showAuthWait = !authReady || userId === null || authMode === null || !telegramIdentityReady;
  const telegramInitialSyncHold =
    isTelegram &&
    authReady &&
    userId != null &&
    authMode === "telegram" &&
    error == null &&
    releases.length === 0 &&
    telegramInitialEmptyRetries < 3;
  const showListSkeleton =
    !hasReleases &&
    (((!showAuthWait && data === undefined && error == null && (isLoading || isValidating)) ||
      telegramInitialSyncHold));
  const showEmptyState =
    authReady &&
    userId != null &&
    !showListSkeleton &&
    !isLoading &&
    error == null &&
    releases.length === 0 &&
    telegramIdentityReady &&
    (!isTelegram || telegramInitialEmptyRetries >= 3);

  const artistFirstName = pickProfileGreetingName(authProfile ?? undefined, greetingName);

  const isEmpty = !showAuthWait && !showListSkeleton && !error && releases.length === 0;

  const heroArtistName = useMemo(() => pickHeroArtistName(releases, artistFirstName), [releases, artistFirstName]);

  /** Открыть релиз: черновик — в мастер, отклонённый — причина и «Исправить», остальное — экран релиза. */
  const openRelease = (release: ReleaseListRow) => {
    const normalized = normalizeReleaseStatus(release.status);
    const isDraft = normalized === "draft" || normalized === "pending";
    if (isDraft && resumingId === release.id) return;
    if (isUnseenDecision(normalized, seenStatuses[release.id])) {
      markStatusSeen(release.id, normalized);
      setSeenVersion((v) => v + 1);
    }
    if (isDraft) {
      void handleResumeDraft(release);
      return;
    }
    if (normalized === "failed") {
      hapticMap.notificationError();
      setAdminNotesModal({
        id: release.id,
        title: getReleaseDisplayTitle(release),
        summary: describeRejection({
          adminNotes: release.admin_notes,
          errorMessage: release.error_message,
          rejectionReasons: release.rejection_reasons
        })
      });
      return;
    }
    hapticMap.impactLight();
    router.push(`/release/${release.id}`);
  };

  const renderReleaseRow = (release: ReleaseListRow, listIndex: number) => {
    const normalized = normalizeReleaseStatus(release.status);
    const isDraft = normalized === "draft" || normalized === "pending";
    const nextStep = getReleaseNextStep({
      status: release.status,
      smartLink: release.smart_link,
      submittedAt: release.submitted_at
    });

    return (
      <ReleaseRow
        key={release.id}
        id={release.id}
        title={getReleaseDisplayTitle(release) || "Без названия"}
        artist={release.artist_name}
        coverUrl={release.artwork_url}
        kind={nextStep.kind}
        statusLine={{
          text: [releaseTypeLabel(release.release_type), nextStep.cardLine || nextStep.title]
            .filter(Boolean)
            .join(" · "),
          className: NEXT_STEP_TONE_CLASS[nextStep.tone]
        }}
        priority={listIndex < 6}
        busy={isDraft && resumingId === release.id}
        isNew={isUnseenDecision(normalized, seenStatuses[release.id])}
        onClick={() => openRelease(release)}
      />
    );
  };

  const heroTitle =
    selectedView === "drafts" ? "Черновики" : selectedView === "moderation" ? "На модерации" : "Релизы";
  const firstReturned = returnedReleases[0] ?? null;
  const firstReturnedReason = firstReturned
    ? describeRejection({
        adminNotes: firstReturned.admin_notes,
        errorMessage: firstReturned.error_message,
        rejectionReasons: firstReturned.rejection_reasons
      }).message.split("\n")[0]
    : "";

  return (
    <div className="min-h-app text-omf-ink">
      <PullRefreshBrand
        onRefresh={() => {
          hapticMap.impactLight();
          void mutate(undefined, { revalidate: true });
        }}
      />
      {isTelegram ? <ReferralWelcome onCreate={handleCreate} /> : null}

      <div className={cn("mx-auto w-full px-1 pb-40 pt-6", isWeb ? "max-w-[1100px]" : "max-w-lg")}>
        {showEmptyState && isEmpty ? null : (
        <header className="mb-6">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/settings"
              onClick={() => hapticMap.impactLight()}
              aria-label={`Профиль: ${heroArtistName}`}
              className="omf-focus group flex min-w-0 items-center gap-2.5 rounded-full pr-2"
            >
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-omf-ultra text-[15px] font-semibold text-white"
              >
                {(heroArtistName.trim()[0] ?? "?").toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold text-omf-ink">{heroArtistName}</span>
                {hasReleases ? (
                  <span className="block text-[13px] text-omf-graphite">
                    {releases.length} {pluralRu(releases.length, ["релиз", "релиза", "релизов"])}
                  </span>
                ) : null}
              </span>
            </Link>
            <button
              type="button"
              onClick={handleCreate}
              className="omf-focus flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-omf-ink px-4 text-[15px] font-semibold text-omf-bg transition-transform active:scale-95"
            >
              <Plus className="h-4 w-4" strokeWidth={2.4} aria-hidden />
              Новый релиз
            </button>
          </div>
          <h1 className="mt-6 text-[32px] font-bold leading-none tracking-[-0.045em] text-omf-ink">{heroTitle}</h1>
          {firstReturned && selectedView === "all" ? (
            <button
              type="button"
              onClick={() => openRelease(firstReturned)}
              className="omf-focus mt-4 flex w-full items-center gap-3 rounded-[14px] bg-[rgba(229,72,77,0.12)] px-3.5 py-3 text-left transition-transform active:scale-[0.98]"
            >
              <span className="block w-10 shrink-0">
                <ReleaseSleeve
                  seed={firstReturned.id}
                  title={getReleaseDisplayTitle(firstReturned) || "Без названия"}
                  coverUrl={firstReturned.artwork_url}
                  size="thumb"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-omf-ink">
                  {returnedReleases.length > 1
                    ? `${returnedReleases.length} ${pluralRu(returnedReleases.length, ["релиз", "релиза", "релизов"])} вернули`
                    : `«${getReleaseDisplayTitle(firstReturned) || "Без названия"}» вернули`}
                </span>
                <span className="block truncate text-[13px] text-[#ff9a9d]">
                  {firstReturnedReason || "Посмотри замечания модератора"}
                </span>
              </span>
              <span className="flex shrink-0 items-center text-[14px] font-semibold text-omf-ink">
                Исправить
                <ChevronRight className="h-4 w-4" aria-hidden />
              </span>
            </button>
          ) : null}
        </header>
        )}

        {!hasReleases && (showAuthWait || showListSkeleton) ? (
          <FullScreenLoader
            state="connecting"
            label={
              !authReady
                ? "Загрузка…"
                : userId === null || authMode === null
                  ? "Подключаем Telegram…"
                  : "Загружаем релизы…"
            }
          />
        ) : !showListSkeleton && error != null ? (
          <div className="border-t border-omf-line pt-6">
            <p className="text-[18px] font-bold tracking-tight">Не удалось загрузить релизы</p>
            <p className="mt-1.5 text-[14px] text-omf-graphite">
              Проверь интернет и попробуй ещё раз. Если не поможет, перезапусти приложение.
            </p>
            <button
              type="button"
              className="omf-btn-primary mt-5"
              onClick={() => void mutate(undefined, { revalidate: true })}
            >
              Загрузить снова
            </button>
          </div>
        ) : showEmptyState && isEmpty ? (
          <FirstReleaseEmpty
            artistName={heroArtistName}
            onCreate={handleCreate}
            referralDiscountPending={referralDiscountPending}
            showInvite={isTelegram}
          />
        ) : (
          <>
            {releases.length >= STATUS_FILTER_MIN_RELEASES && error == null && selectedView === "all" && (
              <div
                className="mb-6 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                role="tablist"
                aria-label="Фильтр по статусу"
              >
                {STATUS_FILTER_CHIPS.map((chip) => {
                  const active = statusFilter === chip.id;
                  const count = statusCounts[chip.id] ?? 0;
                  if (chip.id !== "all" && count === 0) return null;
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => {
                        hapticMap.impactLight();
                        setStatusFilter(chip.id);
                      }}
                      className={cn(
                        "omf-focus shrink-0 rounded-full px-3.5 py-1.5 text-[14px] transition-colors",
                        active ? "bg-omf-surface-2 font-medium text-omf-ink" : "text-omf-graphite hover:text-omf-ink"
                      )}
                    >
                      {chip.label}
                      <span className="ml-1 tabular-nums text-omf-faint">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {hasReleasesInView && filteredReleases.length === 0 && (
              <p className="mb-6 text-[14px] text-omf-graphite">С таким статусом релизов нет.</p>
            )}

            {!hasReleasesInView && hasReleases && selectedView !== "all" && (
              <p className="mb-6 text-[14px] text-omf-graphite">Здесь пока пусто.</p>
            )}

            <div className={cn("flex flex-col gap-1", isWeb && "sm:grid sm:grid-cols-2 sm:gap-x-6 sm:gap-y-1")}>
              {filteredReleases.map((release, i) => renderReleaseRow(release, i))}
            </div>

            {isTelegram && selectedView === "all" ? (
              <div className="mt-5 flex justify-center">
                <ReferralInviteLink />
              </div>
            ) : null}
          </>
        )}
      </div>

      {adminNotesModal && (
        <div
          key="admin-notes-modal"
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onClick={() => setAdminNotesModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-notes-title"
            className="w-full max-w-[420px] rounded-[20px] border border-omf-line bg-omf-surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[13px] text-omf-graphite">{adminNotesModal.title}</p>
                <h2 id="admin-notes-title" className="mt-0.5 text-[18px] font-bold tracking-tight text-omf-ink">
                  Почему релиз отклонён
                </h2>
              </div>
              <button
                type="button"
                className="omf-focus -mr-1 rounded-full p-1.5 text-omf-graphite hover:bg-omf-surface-2 hover:text-omf-ink"
                aria-label="Закрыть"
                onClick={() => setAdminNotesModal(null)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <RejectionNotice
              className="mt-4 max-h-[60vh] overflow-y-auto border-0 p-0"
              showTitle={false}
              summary={adminNotesModal.summary}
              fixing={resumingId === adminNotesModal.id}
              onFix={() => void handleFixRejected(adminNotesModal.id)}
            />
            <button
              type="button"
              className="omf-btn-secondary mt-3 w-full"
              onClick={() => setAdminNotesModal(null)}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LibraryPage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="min-h-app px-5 pb-40 pt-10">
            <div className="mx-auto max-w-lg">
              <div className="mb-8 h-[84px] w-3/4 animate-pulse rounded-control bg-omf-surface" />
              <LibraryReleaseSkeletonGrid count={4} />
            </div>
          </div>
        }
      >
        <LibraryPageInner />
      </Suspense>
    </AuthGuard>
  );
}
