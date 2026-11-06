"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { PullRefreshBrand } from "@/components/PullRefreshBrand";
import { ReleaseSleeve } from "@/components/ReleaseSleeve";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { AdminModerationQueueSkeleton } from "@/components/ui/LibrarySkeleton";
import { fetchAdminCatalog } from "@/features/admin/catalog";
import { isAdminUi, isAdminUiByWebSession, peekWebAdminUi } from "@/lib/admin";
import { artistKey, localIsoDay, splitPitching } from "@/lib/admin-catalog";
import { adminReleaseHref } from "@/lib/admin-nav";
import { formatReleaseDateDayMonthRu } from "@/lib/admin-release-publish";
import { errorToUserString, USER_REQUEST_TIMEOUT_MESSAGE } from "@/lib/errors";
import { useRefreshOnReturn } from "@/lib/hooks/useRefreshOnReturn";
import { formatPressKitUpdatedAt } from "@/lib/press-kit";
import { pluralRu } from "@/lib/release-next-step";
import { SWR_LIST_OPTIONS } from "@/lib/swr-config";
import { getTelegramUserId, initTelegramWebApp } from "@/lib/telegram";
import { cn } from "@/lib/utils";
import { withRequestTimeout } from "@/lib/withRequestTimeout";
import type { AdminCatalogRelease } from "@/types/admin";

const TIMEOUT_MS = 20000;

function daysUntil(isoDay: string, today: string): number {
  return Math.round((Date.parse(`${isoDay}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

function whenLabel(isoDay: string, today: string): string {
  const days = daysUntil(isoDay, today);
  if (days <= 0) return "выходит сегодня";
  if (days === 1) return "выходит завтра";
  return `до выхода ${days} ${pluralRu(days, ["день", "дня", "дней"])}`;
}

function PitchRow({ r, today, upcoming }: { r: AdminCatalogRelease & { pitched_at: string }; today: string; upcoming: boolean }) {
  const date = r.release_date ? formatReleaseDateDayMonthRu(r.release_date) : null;
  const soon = upcoming && r.release_date != null && daysUntil(r.release_date, today) <= 3;
  return (
    <li>
      <Link
        href={adminReleaseHref(r.id, "pitching")}
        className="omf-focus -mx-2 flex items-center gap-3 rounded-[14px] px-2 py-2.5 transition-colors hover:bg-omf-surface active:bg-omf-surface"
      >
        <div className="w-14 shrink-0">
          <ReleaseSleeve seed={r.id} title={r.title} artist={r.artist_name} coverUrl={r.artwork_url} size="thumb" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold leading-tight tracking-[-0.01em]">{r.title}</p>
          <p className="mt-0.5 truncate text-[13px] text-omf-graphite">{r.artist_name}</p>
          <p className="mt-0.5 truncate text-[12px] text-omf-faint">
            {upcoming && r.release_date ? (
              <span className={soon ? "text-omf-yellow" : undefined}>{whenLabel(r.release_date, today)}</span>
            ) : date ? (
              `вышел ${date}`
            ) : (
              "дата выхода не указана"
            )}
            {` · заполнен ${formatPressKitUpdatedAt(r.pitched_at)}`}
          </p>
        </div>
      </Link>
    </li>
  );
}

/** Питчинг: что артисты прислали для редакций. Сначала — релизы, которые ещё не вышли. */
export default function AdminPitchingPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<number | null>(null);
  const [isAdmin, setIsAdmin] = useState(peekWebAdminUi);
  const [adminResolved, setAdminResolved] = useState(peekWebAdminUi);
  const [query, setQuery] = useState("");

  useEffect(() => {
    initTelegramWebApp();
    setUserId(getTelegramUserId());
    setIsAdmin((prev) => prev || isAdminUi());
    void (async () => {
      const webAdmin = await isAdminUiByWebSession();
      setIsAdmin((prev) => prev || webAdmin);
      setAdminResolved(true);
    })();
  }, []);

  useEffect(() => {
    if (adminResolved && !isAdmin) router.replace("/");
  }, [adminResolved, isAdmin, router]);

  // Тот же ключ, что у каталога: один запрос на обе вкладки.
  const { data, error, isLoading, mutate } = useSWR(
    isAdmin ? (["admin-catalog"] as const) : null,
    () => withRequestTimeout(fetchAdminCatalog(), TIMEOUT_MS, USER_REQUEST_TIMEOUT_MESSAGE),
    { ...SWR_LIST_OPTIONS, keepPreviousData: true }
  );
  useRefreshOnReturn(() => {
    if (isAdmin) void mutate();
  });

  const today = localIsoDay();
  const { upcoming, released } = useMemo(() => {
    const q = artistKey(query);
    const rows = (data?.rows ?? []).filter(
      (r) => !q || artistKey(r.artist_name).includes(q) || artistKey(r.title).includes(q)
    );
    return splitPitching(rows, today);
  }, [data?.rows, query, today]);

  const total = useMemo(() => splitPitching(data?.rows ?? [], today), [data?.rows, today]);
  const totalCount = total.upcoming.length + total.released.length;
  const errorMessage = errorToUserString(error);
  const showSkeleton = isLoading && data === undefined;

  if (adminResolved && !isAdmin) return null;

  if (userId == null && !isAdmin && process.env.NODE_ENV === "production") {
    return (
      <div className="mx-auto max-w-lg px-1 pt-10">
        <h1 className="text-[28px] font-extrabold tracking-[-0.03em]">Питчинг</h1>
        <p className="mt-2 text-[15px] text-omf-graphite">Открой приложение из Telegram, чтобы попасть в админку.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-app max-w-lg px-1 pb-40 pt-6 text-omf-ink lg:max-w-3xl">
      <PullRefreshBrand onRefresh={() => void mutate(undefined, { revalidate: true })} />

      <header className="mb-5">
        <h1 className="text-[32px] font-bold leading-none tracking-[-0.045em]">Модерация</h1>
        <p className="mt-2 text-[14px] text-omf-graphite">
          {total.upcoming.length > 0
            ? `${total.upcoming.length} ${pluralRu(total.upcoming.length, ["релиз ждёт", "релиза ждут", "релизов ждут"])} отправки редакциям`
            : "Пресс-релизы артистов для редакций"}
        </p>
      </header>
      <AdminTabs active="pitching" counts={{ pitching: data ? total.upcoming.length : undefined }} />

      {errorMessage && <p className="mb-4 text-[14px] text-omf-red">{errorMessage}</p>}
      {showSkeleton && <AdminModerationQueueSkeleton rows={3} />}

      {totalCount >= 6 ? (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Релиз или артист"
          aria-label="Поиск по питчингу"
          className="omf-focus mb-2 h-11 w-full rounded-[12px] bg-omf-surface px-3.5 text-[16px] text-omf-ink placeholder:text-omf-faint focus:outline-none focus:ring-1 focus:ring-omf-ultra"
        />
      ) : null}

      {!showSkeleton && !errorMessage && data && totalCount === 0 ? (
        <div className="border-t border-omf-line pt-6">
          <p className="text-[18px] font-bold tracking-tight">Пока никто не заполнил</p>
          <p className="mt-1.5 text-[14px] text-omf-graphite">
            Артист может заполнить питчинг, когда получит ссылку на релиз. Бот пришлёт уведомление, как только это
            случится.
          </p>
        </div>
      ) : null}

      {totalCount > 0 && upcoming.length + released.length === 0 ? (
        <p className="border-t border-omf-line pt-6 text-[14px] text-omf-graphite">Ничего не нашлось. Поменяй запрос.</p>
      ) : null}

      {upcoming.length > 0 ? (
        <section aria-labelledby="pitch-upcoming" className="mt-2">
          <h2 id="pitch-upcoming" className="text-[15px] font-bold tracking-tight">
            До выхода
          </h2>
          <p className="mt-0.5 text-[13px] leading-snug text-omf-graphite">
            Отправь редакциям, пока релиз не вышел. Ближайшие сверху.
          </p>
          <ul className="mt-1 flex flex-col">
            {upcoming.map((r) => (
              <PitchRow key={r.id} r={r} today={today} upcoming />
            ))}
          </ul>
        </section>
      ) : null}

      {released.length > 0 ? (
        <section aria-labelledby="pitch-released" className={cn(upcoming.length > 0 ? "mt-8" : "mt-2")}>
          <h2 id="pitch-released" className="text-[15px] font-bold tracking-tight">
            Уже вышли
          </h2>
          <ul className="mt-1 flex flex-col">
            {released.map((r) => (
              <PitchRow key={r.id} r={r} today={today} upcoming={false} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
