"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { AdminReleaseCard } from "@/components/AdminReleaseCard";
import { PullRefreshBrand } from "@/components/PullRefreshBrand";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { AdminModerationQueueSkeleton } from "@/components/ui/LibrarySkeleton";
import { fetchAdminModerationHistory } from "@/features/admin/moderation-history";
import { isAdminUi, isAdminUiByWebSession } from "@/lib/admin";
import { debugInit } from "@/lib/debug";
import type { ReleaseRecord, ReleaseTrackRow } from "@/repositories/releases.repo";
import { getTelegramUserId, initTelegramWebApp } from "@/lib/telegram";
import { errorToUserString, USER_REQUEST_TIMEOUT_MESSAGE } from "@/lib/errors";
import { SWR_LIST_OPTIONS } from "@/lib/swr-config";
import { withRequestTimeout } from "@/lib/withRequestTimeout";
import { countHistoryByStatus, filterHistory, type HistoryStatusFilter } from "@/lib/admin-history-filter";
import { hapticMap } from "@/lib/haptic-map";
import { cn } from "@/lib/utils";

type HistoryRow = {
  release: ReleaseRecord;
  tracks: ReleaseTrackRow[];
};

const HISTORY_LIMIT = 300;
const HISTORY_TABS: { key: HistoryStatusFilter; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "ready", label: "Приняты" },
  { key: "failed", label: "Возвращены" }
];
const ADMIN_HISTORY_TIMEOUT_MS = 20000;
const INITIAL_VISIBLE_ROWS = 40;
const VISIBLE_ROWS_CHUNK = 40;
const NEAR_BOTTOM_OFFSET_PX = 900;

export default function AdminModerationHistoryPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<number | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminResolved, setAdminResolved] = useState(false);
  const [visibleRowsCount, setVisibleRowsCount] = useState(INITIAL_VISIBLE_ROWS);
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    debugInit("admin/history", "init start");
    initTelegramWebApp();
    setUserId(getTelegramUserId());
    setIsAdmin(isAdminUi());
    void (async () => {
      const webAdmin = await isAdminUiByWebSession();
      setIsAdmin((prev) => prev || webAdmin);
      setAdminResolved(true);
    })();
    debugInit("admin/history", "init done");
  }, []);

  useEffect(() => {
    if (adminResolved && !isAdmin) {
      router.replace("/");
    }
  }, [adminResolved, isAdmin, router]);

  const swrKey = isAdmin ? (["admin-moderation-history", HISTORY_LIMIT] as const) : null;

  const loadHistory = useCallback(async (): Promise<{ rows: HistoryRow[]; truncated: boolean }> => {
    return fetchAdminModerationHistory(HISTORY_LIMIT);
  }, []);

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    swrKey,
    () =>
      withRequestTimeout(loadHistory(), ADMIN_HISTORY_TIMEOUT_MS, USER_REQUEST_TIMEOUT_MESSAGE),
    {
      ...SWR_LIST_OPTIONS,
      keepPreviousData: true
    }
  );

  const allRows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const counts = useMemo(() => countHistoryByStatus(allRows), [allRows]);
  const rows = useMemo(() => filterHistory(allRows, statusFilter, query), [allRows, statusFilter, query]);
  const visibleRows = useMemo(
    () => rows.slice(0, Math.min(visibleRowsCount, rows.length)),
    [rows, visibleRowsCount]
  );
  const hasMoreRows = visibleRows.length < rows.length;
  const listTruncated = data?.truncated === true;
  const errorMessage = errorToUserString(error);
  const showSkeleton = isLoading && data === undefined;

  useEffect(() => {
    setVisibleRowsCount(INITIAL_VISIBLE_ROWS);
  }, [rows.length, statusFilter, query]);

  useEffect(() => {
    if (!hasMoreRows) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        const nearBottom =
          window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - NEAR_BOTTOM_OFFSET_PX;
        if (nearBottom) {
          setVisibleRowsCount((prev) => Math.min(prev + VISIBLE_ROWS_CHUNK, rows.length));
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, [hasMoreRows, rows.length]);

  if (adminResolved && !isAdmin) {
    return null;
  }

  if (userId == null && !isAdmin && process.env.NODE_ENV === "production") {
    return (
      <div className="mx-auto max-w-lg px-1 pt-10">
        <h1 className="text-[28px] font-extrabold tracking-[-0.03em]">История решений</h1>
        <p className="mt-2 text-[15px] text-omf-graphite">Открой приложение из Telegram, чтобы попасть в админку.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-app max-w-lg px-1 pb-40 pt-6 text-omf-ink lg:max-w-3xl">
      <PullRefreshBrand onRefresh={() => void mutate(undefined, { revalidate: true })} />

      <header className="mb-5">
        <h1 className="text-[32px] font-bold leading-none tracking-[-0.045em]">Модерация</h1>
        <p className="mt-2 text-[14px] text-omf-graphite">Принятые и возвращённые</p>
      </header>
      <AdminTabs active="history" />

      {listTruncated && allRows.length > 0 && (
        <p className="mb-4 text-[14px] text-omf-yellow">
          Показаны последние {HISTORY_LIMIT} релизов. Более старых здесь пока нет.
        </p>
      )}

      {errorMessage && <p className="mb-4 text-[14px] text-omf-red">{errorMessage}</p>}

      {showSkeleton && <AdminModerationQueueSkeleton rows={4} />}

      {allRows.length > 0 ? (
        <>
          <div
            className="mb-4 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="tablist"
            aria-label="Фильтр истории"
          >
            {HISTORY_TABS.map((tab) => {
              const active = statusFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    hapticMap.impactLight();
                    setStatusFilter(tab.key);
                  }}
                  className={cn(
                    "omf-focus shrink-0 rounded-full px-3.5 py-1.5 text-[13px] transition-colors",
                    active ? "bg-omf-surface-2 font-medium text-omf-ink" : "text-omf-graphite hover:text-omf-ink"
                  )}
                >
                  {tab.label}
                  <span className={"ml-1.5 tabular-nums text-omf-faint"}>
                    {counts[tab.key]}
                  </span>
                </button>
              );
            })}
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Артист, название, ID или ссылка"
            aria-label="Поиск по истории"
            className="omf-focus mb-4 h-11 w-full rounded-[12px] bg-omf-surface px-3.5 text-[16px] text-omf-ink placeholder:text-omf-faint focus:outline-none focus:ring-1 focus:ring-omf-ultra"
          />
        </>
      ) : null}

      {!showSkeleton && !errorMessage && allRows.length === 0 && (
        <div className="border-t border-omf-line pt-6">
          <p className="text-[18px] font-bold tracking-tight">История пока пуста</p>
          <p className="mt-1.5 text-[14px] text-omf-graphite">
            Здесь появятся релизы, по которым вы приняли решение.
          </p>
        </div>
      )}

      {!showSkeleton && allRows.length > 0 && rows.length === 0 && (
        <p className="border-t border-omf-line pt-6 text-[14px] text-omf-graphite">
          Ничего не нашлось. Попробуй другой фильтр или запрос.
        </p>
      )}

      {rows.length > 0 && (
        <div className="flex flex-col">
          {visibleRows.map((row, index) => (
            <AdminReleaseCard
              key={row.release.id}
              release={row.release}
              tracks={row.tracks}
              index={index}
              listVariants={undefined}
              busy={false}
              onOpenApprove={() => {}}
              onOpenReject={() => {}}
              showModerationActions={false}
              showAudioPreview={false}
              detailHref={`/admin/release/${row.release.id}`}
              artworkPriority={index < 4}
            />
          ))}
        </div>
      )}

      {hasMoreRows && (
        <button
          type="button"
          onClick={() => setVisibleRowsCount((prev) => Math.min(prev + VISIBLE_ROWS_CHUNK, rows.length))}
          className="omf-btn-secondary mt-5 w-full"
        >
          Показать ещё ({visibleRows.length} из {rows.length})
        </button>
      )}
    </div>
  );
}
