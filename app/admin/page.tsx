"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { AdminApproveSmartLinkModal, type ApproveModalMode } from "@/components/AdminApproveSmartLinkModal";
import { AdminAwaitingLinkList } from "@/components/admin/AdminAwaitingLinkList";
import { AdminTabs, type AdminTab } from "@/components/admin/AdminTabs";
import { fetchAdminAwaitingLink } from "@/features/admin/awaiting-link";
import { AdminRejectModal } from "@/components/AdminRejectModal";
import { AdminReleaseCard } from "@/components/AdminReleaseCard";
import { AdminStatsPanel } from "@/components/admin/AdminStatsPanel";
import { AdminStuckList } from "@/components/admin/AdminStuckList";
import { PullRefreshBrand } from "@/components/PullRefreshBrand";
import { AdminModerationQueueSkeleton } from "@/components/ui/LibrarySkeleton";
import { approveRelease, publishReleaseWithSmartLink, rejectRelease } from "@/features/admin/actions";
import { fetchAdminModerationQueue } from "@/features/admin/moderation-queue";
import { isAdminUi, isAdminUiByWebSession, peekWebAdminUi } from "@/lib/admin";
import { isPaymentConfirmed } from "@/lib/release-payment";
import { debugInit } from "@/lib/debug";
import { fetchAdminStats } from "@/lib/fetch-admin-stats";
import type { ReleaseRecord, ReleaseTrackRow } from "@/repositories/releases.repo";
import { hapticMap } from "@/lib/haptic-map";
import { getTelegramUserId, initTelegramWebApp, triggerHaptic } from "@/lib/telegram";
import { errorToUserString, USER_REQUEST_TIMEOUT_MESSAGE } from "@/lib/errors";
import { useRefreshOnReturn } from "@/lib/hooks/useRefreshOnReturn";
import { SWR_LIST_OPTIONS } from "@/lib/swr-config";
import { withRequestTimeout } from "@/lib/withRequestTimeout";
import { useIsTelegramMiniApp } from "@/lib/hooks/useIsTelegramMiniApp";
import { cn } from "@/lib/utils";
import { pluralRu } from "@/lib/release-next-step";

type ModerationQueueRow = {
  release: ReleaseRecord;
  tracks: ReleaseTrackRow[];
};

type QueueFilterKey = "all" | "with_errors";

const ADMIN_QUEUE_TIMEOUT_MS = 15000;

function AdminPageInner() {
  const router = useRouter();
  const view: AdminTab = useSearchParams().get("view") === "links" ? "links" : "queue";
  const [userId, setUserId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectModalReleaseId, setRejectModalReleaseId] = useState<string | null>(null);
  /** «Принять» для релиза из очереди или «Добавить ссылку» для принятого. */
  const [approveModal, setApproveModal] = useState<{ id: string; mode: ApproveModalMode } | null>(null);
  const [isAdmin, setIsAdmin] = useState(peekWebAdminUi);
  const [adminResolved, setAdminResolved] = useState(peekWebAdminUi);
  const [activeFilter, setActiveFilter] = useState<QueueFilterKey>("all");
  const [searchQuery, setSearchQuery] = useState("");
  /** Режим выбора: по кнопке «Выбрать», тап по карточке отмечает её, решение — в нижней панели. */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedReleaseIds, setSelectedReleaseIds] = useState<string[]>([]);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  /** Среди выбранных есть без подтверждённой оплаты: первое нажатие «Принять» только предупреждает. */
  const [bulkAcceptArmed, setBulkAcceptArmed] = useState(false);
  /** Нижняя панель — в портале: у обёртки страницы transform, `fixed` внутри неё уезжает под навигацию. */
  const [portalReady, setPortalReady] = useState(false);
  /** Сайдбар веб-версии: панель начинается справа от него (как на странице релиза). */
  const wide = !useIsTelegramMiniApp();

  useEffect(() => {
    setPortalReady(true);
    debugInit("admin", "init start");
    initTelegramWebApp();
    setUserId(getTelegramUserId());
    setIsAdmin((prev) => prev || isAdminUi());
    void (async () => {
      const webAdmin = await isAdminUiByWebSession();
      setIsAdmin((prev) => prev || webAdmin);
      setAdminResolved(true);
    })();
    debugInit("admin", "init done");
  }, []);

  useEffect(() => {
    if (adminResolved && !isAdmin) {
      router.replace("/");
    }
  }, [adminResolved, isAdmin, router]);

  const swrKey = isAdmin ? (["admin-moderation-queue"] as const) : null;
  const statsKey = isAdmin ? (["admin-stats"] as const) : null;

  const loadQueueCore = useCallback(async (): Promise<ModerationQueueRow[]> => {
    return fetchAdminModerationQueue();
  }, []);

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    swrKey,
    () =>
      withRequestTimeout(
        loadQueueCore(),
        ADMIN_QUEUE_TIMEOUT_MS,
        USER_REQUEST_TIMEOUT_MESSAGE
      ),
    {
      ...SWR_LIST_OPTIONS,
      refreshInterval: 8000,
      keepPreviousData: true
    }
  );

  const {
    data: stats,
    error: statsError,
    mutate: mutateStats
  } = useSWR(statsKey, fetchAdminStats, {
    ...SWR_LIST_OPTIONS,
    refreshInterval: 15000
  });

  const moderationQueue = useMemo(() => data ?? [], [data]);
  const moderationQueueFilteredByPreset = useMemo(
    () =>
      moderationQueue.filter((row) => {
        const hasError = (row.release.error_message ?? "").trim().length > 0;
        if (activeFilter === "with_errors") return hasError;
        return true;
      }),
    [moderationQueue, activeFilter]
  );
  const filterCounts: Record<QueueFilterKey, number> = {
    all: moderationQueue.length,
    with_errors: moderationQueue.filter((row) => (row.release.error_message ?? "").trim().length > 0).length
  };
  const searchNeedle = searchQuery.trim().toLowerCase();
  const moderationQueueFiltered = useMemo(
    () =>
      moderationQueueFilteredByPreset.filter((row) => {
        if (!searchNeedle) return true;
        const id = row.release.id.toLowerCase();
        const artist = row.release.artist_name.toLowerCase();
        const title = (
          (typeof row.release.title === "string" && row.release.title.trim()) ||
          (typeof row.release.track_name === "string" && row.release.track_name.trim()) ||
          ""
        ).toLowerCase();
        const smartLink = (row.release.smart_link ?? "").toLowerCase();
        return (
          id.includes(searchNeedle) ||
          artist.includes(searchNeedle) ||
          title.includes(searchNeedle) ||
          smartLink.includes(searchNeedle)
        );
      }),
    [moderationQueueFilteredByPreset, searchNeedle]
  );
  const errorMessage = errorToUserString(error);
  const statsErrorMessage = errorToUserString(statsError);
  const awaitingKey = isAdmin ? (["admin-awaiting-link"] as const) : null;
  const { data: awaitingLink, mutate: mutateAwaiting } = useSWR(awaitingKey, fetchAdminAwaitingLink, {
    ...SWR_LIST_OPTIONS,
    refreshInterval: 30000
  });

  const refreshAll = useCallback(async () => {
    await Promise.all([
      mutate(undefined, { revalidate: true }),
      mutateStats(undefined, { revalidate: true }),
      mutateAwaiting(undefined, { revalidate: true })
    ]);
  }, [mutate, mutateStats, mutateAwaiting]);

  /** Вернулись в свёрнутый мини-апп — подтянуть очередь заново, а не показывать старую. */
  useRefreshOnReturn(() => {
    if (!isAdmin) return;
    void mutate();
    void mutateStats();
    void mutateAwaiting();
  });

  useEffect(() => {
    setSelectedReleaseIds((prev) => {
      const next = prev.filter((id) => moderationQueueFiltered.some((row) => row.release.id === id));
      if (next.length === prev.length && next.every((id, idx) => id === prev[idx])) {
        return prev;
      }
      return next;
    });
  }, [moderationQueueFiltered]);

  const handleAccept = useCallback(
    async (releaseId: string) => {
      setBusyId(releaseId);
      setActionError(null);
      try {
        await approveRelease(releaseId);
        triggerHaptic("success");
        setApproveModal(null);
        await refreshAll();
        toast.success("Принят. Артисту ушло сообщение, ссылку добавишь позже");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Не удалось принять релиз.";
        setActionError(msg);
        toast.error(msg);
      } finally {
        setBusyId(null);
      }
    },
    [refreshAll]
  );

  const handleSubmitLink = useCallback(
    async (releaseId: string, smartLink: string, upc: string, releaseDate: string) => {
      setBusyId(releaseId);
      setActionError(null);
      try {
        await publishReleaseWithSmartLink(releaseId, "RELEASED", smartLink, upc, releaseDate);
        triggerHaptic("success");
        setApproveModal(null);
        await refreshAll();
        toast.success("Ссылка отправлена артисту");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Не удалось сохранить ссылку.";
        setActionError(msg);
        toast.error(msg);
      } finally {
        setBusyId(null);
      }
    },
    [refreshAll]
  );

  const handleRejectWithReason = useCallback(
    async (id: string, reason: string, reasonKeys: string[]) => {
      setBusyId(id);
      setActionError(null);
      try {
        await rejectRelease(id, reason, reasonKeys);
        hapticMap.notificationWarning();
        setRejectModalReleaseId(null);
        await refreshAll();
        toast.success("Релиз отклонён");
        router.replace("/admin");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Не удалось обновить статус релиза.";
        setActionError(msg);
        toast.error(msg);
      } finally {
        setBusyId(null);
      }
    },
    [refreshAll, router]
  );

  const toggleSelectRelease = useCallback((releaseId: string) => {
    setSelectedReleaseIds((prev) =>
      prev.includes(releaseId) ? prev.filter((id) => id !== releaseId) : [...prev, releaseId]
    );
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelectedReleaseIds(moderationQueueFiltered.map((row) => row.release.id));
  }, [moderationQueueFiltered]);

  const clearSelection = useCallback(() => {
    setSelectedReleaseIds([]);
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedReleaseIds([]);
  }, []);

  const handleBulkReject = useCallback(
    async (reason: string, reasonKeys: string[]) => {
      if (selectedReleaseIds.length === 0) return;
      setBulkBusy(true);
      setActionError(null);
      let successCount = 0;
      let failedCount = 0;
      for (const releaseId of selectedReleaseIds) {
        try {
          await rejectRelease(releaseId, reason, reasonKeys);
          successCount += 1;
        } catch {
          failedCount += 1;
        }
      }
      await refreshAll();
      setBulkBusy(false);
      setBulkRejectOpen(false);
      exitSelectMode();
      if (failedCount === 0) {
        hapticMap.notificationWarning();
        toast.success(`Отклонено релизов: ${successCount}`);
      } else {
        toast.error(`Отклонено: ${successCount}, с ошибкой: ${failedCount}`);
      }
    },
    [refreshAll, selectedReleaseIds, exitSelectMode]
  );

  const unpaidSelectedCount = useMemo(
    () =>
      moderationQueue.filter(
        (row) => selectedReleaseIds.includes(row.release.id) && !isPaymentConfirmed(row.release.payment_status)
      ).length,
    [moderationQueue, selectedReleaseIds]
  );

  useEffect(() => {
    setBulkAcceptArmed(false);
  }, [selectedReleaseIds]);

  const handleBulkAccept = useCallback(async () => {
    if (selectedReleaseIds.length === 0) return;
    setBulkAcceptArmed(false);
    setBulkBusy(true);
    setActionError(null);
    let successCount = 0;
    let failedCount = 0;
    for (const releaseId of selectedReleaseIds) {
      try {
        await approveRelease(releaseId);
        successCount += 1;
      } catch {
        failedCount += 1;
      }
    }
    await refreshAll();
    setBulkBusy(false);
    exitSelectMode();
    if (failedCount === 0) {
      triggerHaptic("success");
      toast.success(`Принято релизов: ${successCount}`);
      return;
    }
    toast.error(`Принято: ${successCount}, с ошибкой: ${failedCount}`);
  }, [refreshAll, selectedReleaseIds, exitSelectMode]);

  if (adminResolved && !isAdmin) {
    return null;
  }

  if (userId == null && !isAdmin && process.env.NODE_ENV === "production") {
    return (
      <div className="mx-auto max-w-lg px-1 pt-10">
        <h1 className="text-[28px] font-extrabold tracking-[-0.03em]">Модерация</h1>
        <p className="mt-2 text-[15px] text-omf-graphite">
          Открой приложение из Telegram, чтобы попасть в админку.
        </p>
      </div>
    );
  }

  const showQueueSkeleton = isLoading && data === undefined;
  const errorsChip = (extra: string) => (
    <button
      type="button"
      aria-pressed={activeFilter === "with_errors"}
      onClick={() => setActiveFilter(activeFilter === "with_errors" ? "all" : "with_errors")}
      className={cn(
        "omf-focus h-8 shrink-0 rounded-full px-3 text-[13px] transition-colors",
        activeFilter === "with_errors" ? "bg-[rgba(229,72,77,0.16)] text-[#ff9a9d]" : "bg-omf-surface-2 text-omf-graphite",
        extra
      )}
    >
      С ошибками <span className="tabular-nums">{filterCounts.with_errors}</span>
    </button>
  );
  return (
    <div className="mx-auto min-h-app max-w-lg px-1 pb-40 pt-6 text-omf-ink lg:max-w-3xl">
      <PullRefreshBrand onRefresh={() => void refreshAll()} />

      <header className="mb-5">
        <h1 className="text-[32px] font-bold leading-none tracking-[-0.045em]">Модерация</h1>
        <p className="mt-2 text-[14px] text-omf-graphite">
          {view === "links" ? (
            awaitingLink && awaitingLink.length > 0 ? (
              `${awaitingLink.length} ${pluralRu(awaitingLink.length, ["релиз ждёт", "релиза ждут", "релизов ждут"])} ссылку`
            ) : (
              "Принятые релизы без ссылки"
            )
          ) : moderationQueue.length > 0 ? (
            <>
              {moderationQueue.length} {pluralRu(moderationQueue.length, ["ждёт", "ждут", "ждут"])} решения
              {stats?.oldest_wait_hours != null ? (
                <>
                  {" · самый долгий "}
                  <span className={stats.oldest_wait_hours >= 24 ? "text-omf-red" : "text-omf-ink"}>
                    {stats.oldest_wait_hours} ч
                  </span>
                </>
              ) : null}
            </>
          ) : (
            "Очередь пуста"
          )}
        </p>
      </header>
      <AdminTabs active={view} counts={{ queue: moderationQueue.length, links: awaitingLink?.length }} />

      <AdminApproveSmartLinkModal
        releaseId={approveModal?.id ?? null}
        mode={approveModal?.mode ?? "accept"}
        paymentStatus={moderationQueue.find((row) => row.release.id === approveModal?.id)?.release.payment_status ?? null}
        busy={approveModal != null && busyId === approveModal.id}
        onClose={() => setApproveModal(null)}
        onAccept={(id) => void handleAccept(id)}
        releaseDate={
          moderationQueue.find((row) => row.release.id === approveModal?.id)?.release.release_date ??
          awaitingLink?.find((row) => row.id === approveModal?.id)?.release_date ??
          null
        }
        onSubmitLink={(id, link, upc, date) => void handleSubmitLink(id, link, upc, date)}
      />

      <AdminRejectModal
        open={rejectModalReleaseId != null}
        busy={rejectModalReleaseId != null && busyId === rejectModalReleaseId}
        onClose={() => setRejectModalReleaseId(null)}
        onSubmit={(reason, keys) => {
          if (rejectModalReleaseId) void handleRejectWithReason(rejectModalReleaseId, reason, keys);
        }}
      />

      <AdminRejectModal
        open={bulkRejectOpen}
        busy={bulkBusy}
        count={selectedReleaseIds.length}
        onClose={() => setBulkRejectOpen(false)}
        onSubmit={(reason, keys) => void handleBulkReject(reason, keys)}
      />

      {view === "queue" ? (
        <>
      {/* Поиск, фильтр «С ошибками» и выбор нескольких — одной строкой. Поиск нужен от 4 релизов. */}
      {moderationQueue.length >= 4 || filterCounts.with_errors > 0 || selectMode || moderationQueueFiltered.length > 1 ? (
        <div className="mb-2 flex items-center gap-2">
          {moderationQueue.length >= 4 ? (
            <div className="relative min-w-0 flex-1">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск"
                aria-label="Поиск по очереди"
                className={cn(
                  "omf-focus h-11 w-full rounded-[12px] bg-omf-surface pl-3.5 text-[16px] text-omf-ink placeholder:text-omf-faint focus:outline-none focus:ring-1 focus:ring-omf-ultra",
                  filterCounts.with_errors > 0 ? "pr-[124px]" : "pr-3.5"
                )}
              />
              {filterCounts.with_errors > 0 ? errorsChip("absolute right-1.5 top-1/2 -translate-y-1/2") : null}
            </div>
          ) : (
            <>
              <div className="flex-1" />
              {filterCounts.with_errors > 0 ? errorsChip("") : null}
            </>
          )}
          {selectMode || moderationQueueFiltered.length > 1 ? (
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                if (selectMode) exitSelectMode();
                else setSelectMode(true);
              }}
              aria-pressed={selectMode}
              className={cn(
                "omf-focus h-9 shrink-0 rounded-full px-2 text-[13px] transition-colors hover:text-omf-ink",
                selectMode ? "font-medium text-omf-ink" : "text-omf-ultra-text"
              )}
            >
              {selectMode ? "Готово" : "Выбрать"}
            </button>
          ) : null}
        </div>
      ) : null}

      {selectMode && moderationQueueFiltered.length > 0 ? (
        <div className="mb-1 flex items-center justify-between gap-3 text-[13px]">
          <p className="tabular-nums text-omf-graphite" aria-live="polite">
            Выбрано: {selectedReleaseIds.length} из {moderationQueueFiltered.length}
          </p>
          <button
            type="button"
            onClick={() =>
              selectedReleaseIds.length === moderationQueueFiltered.length ? clearSelection() : selectAllFiltered()
            }
            className="omf-focus rounded-full px-2.5 py-1.5 text-omf-ultra-text hover:text-omf-ink"
          >
            {selectedReleaseIds.length === moderationQueueFiltered.length ? "Снять все" : "Выбрать все"}
          </button>
        </div>
      ) : null}

      {showQueueSkeleton && <AdminModerationQueueSkeleton rows={3} />}
      {errorMessage && (
        <p className="mb-4 text-[14px] text-omf-red">{errorMessage}</p>
      )}
      {actionError && (
        <p className="mb-4 text-[14px] text-omf-red">{actionError}</p>
      )}

      {!showQueueSkeleton && !errorMessage && moderationQueueFiltered.length === 0 && (
        <div className="border-t border-omf-line pt-6">
          <p className="text-[18px] font-bold tracking-tight">
            {moderationQueue.length === 0 ? "Очередь пуста" : "Ничего не найдено"}
          </p>
          <p className="mt-1.5 text-[14px] text-omf-graphite">
            {moderationQueue.length === 0
              ? "Новые релизы появятся здесь, когда артисты отправят их на проверку."
              : "Попробуй другой фильтр или поменяй запрос."}
          </p>
        </div>
      )}

      {moderationQueueFiltered.length > 0 && (
        <div className="flex flex-col">
          {moderationQueueFiltered.map((row, index) => (
            <AdminReleaseCard
              key={row.release.id}
              release={row.release}
              tracks={row.tracks}
              index={index}
              listVariants={undefined}
              busy={busyId === row.release.id}
              onOpenApprove={() => setApproveModal({ id: row.release.id, mode: "accept" })}
              onOpenReject={() => setRejectModalReleaseId(row.release.id)}
              showAudioPreview={false}
              detailHref={`/admin/release/${row.release.id}`}
              artworkPriority={index < 3}
              selectMode={selectMode}
              selected={selectedReleaseIds.includes(row.release.id)}
              onToggleSelect={() => toggleSelectRelease(row.release.id)}
            />
          ))}
        </div>
      )}

          {stats ? <AdminStuckList stuck={stats.stuck} onDeleted={() => void mutateStats()} /> : null}
          {stats && !statsErrorMessage ? <AdminStatsPanel stats={stats} /> : null}
          {statsErrorMessage ? (
            <p className="mt-6 text-[14px] text-omf-yellow">Не удалось загрузить счётчики: {statsErrorMessage}</p>
          ) : null}
        </>
      ) : awaitingLink && awaitingLink.length > 0 ? (
        <AdminAwaitingLinkList asTab rows={awaitingLink} onAddLink={(id) => setApproveModal({ id, mode: "link" })} />
      ) : (
        <div className="pt-2">
          <p className="text-[18px] font-bold tracking-tight">Все ссылки на месте</p>
          <p className="mt-1.5 text-[14px] text-omf-graphite">
            Здесь появятся принятые релизы, которым ещё нужна ссылка BandLink.
          </p>
        </div>
      )}

      {selectMode && portalReady
        ? createPortal(
            <div
              role="group"
              aria-label="Решение по выбранным"
              className={cn(
                "fixed inset-x-0 bottom-0 z-[60] border-t border-omf-line bg-omf-bg pb-[env(safe-area-inset-bottom,0px)]",
                wide && "lg:left-64"
              )}
            >
              {bulkAcceptArmed ? (
                <p className="mx-auto max-w-lg px-4 pt-3 text-[13px] text-omf-yellow lg:max-w-3xl">
                  Без подтверждённой оплаты: {unpaidSelectedCount}. Нажми ещё раз, чтобы всё равно принять.
                </p>
              ) : null}
              <div className="mx-auto flex max-w-lg items-center gap-2.5 px-4 py-3 lg:max-w-3xl">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("light");
                    setBulkRejectOpen(true);
                  }}
                  disabled={bulkBusy || selectedReleaseIds.length === 0}
                  className="omf-btn-secondary flex-1 disabled:opacity-40"
                >
                  Вернуть{selectedReleaseIds.length > 0 ? ` ${selectedReleaseIds.length}` : ""}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (unpaidSelectedCount > 0 && !bulkAcceptArmed) {
                      triggerHaptic("warning");
                      setBulkAcceptArmed(true);
                      return;
                    }
                    void handleBulkAccept();
                  }}
                  disabled={bulkBusy || selectedReleaseIds.length === 0}
                  className={cn(
                    "omf-btn-ink flex-1 disabled:opacity-40",
                    bulkAcceptArmed && "bg-omf-yellow text-black"
                  )}
                >
                  {bulkBusy
                    ? "Секунду…"
                    : bulkAcceptArmed
                      ? "Да, принять"
                      : `Принять${selectedReleaseIds.length > 0 ? ` ${selectedReleaseIds.length}` : ""}`}
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminPageInner />
    </Suspense>
  );
}
