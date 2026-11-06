"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { PullRefreshBrand } from "@/components/PullRefreshBrand";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { ReleaseSleeve } from "@/components/ReleaseSleeve";
import { AdminModerationQueueSkeleton } from "@/components/ui/LibrarySkeleton";
import { fetchAdminCatalog } from "@/features/admin/catalog";
import { isAdminUi, isAdminUiByWebSession } from "@/lib/admin";
import {
  flattenCatalogTracks,
  groupCatalogByArtist,
  matchesCatalogTrack,
  summarizeCatalog,
  artistKey
} from "@/lib/admin-catalog";
import { formatAgoRu } from "@/lib/admin-release-metadata";
import { errorToUserString, USER_REQUEST_TIMEOUT_MESSAGE } from "@/lib/errors";
import { hapticMap } from "@/lib/haptic-map";
import { adminReleaseHref } from "@/lib/admin-nav";
import { pluralRu } from "@/lib/release-next-step";
import { SWR_LIST_OPTIONS } from "@/lib/swr-config";
import { getTelegramUserId, initTelegramWebApp } from "@/lib/telegram";
import { cn } from "@/lib/utils";
import { withRequestTimeout } from "@/lib/withRequestTimeout";

type CatalogTab = "tracks" | "artists";

const CATALOG_TIMEOUT_MS = 20000;
const VISIBLE_CHUNK = 50;

const TYPE_LABEL = { single: "Сингл", ep: "EP", album: "Альбом" } as const;

function formatAcceptedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

/** Каталог: всё, что приняли и отгрузили на площадки, — треки, артисты, итоги. */
export default function AdminCatalogPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<number | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminResolved, setAdminResolved] = useState(false);
  const [tab, setTab] = useState<CatalogTab>("tracks");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(VISIBLE_CHUNK);

  useEffect(() => {
    initTelegramWebApp();
    setUserId(getTelegramUserId());
    setIsAdmin(isAdminUi());
    void (async () => {
      const webAdmin = await isAdminUiByWebSession();
      setIsAdmin((prev) => prev || webAdmin);
      setAdminResolved(true);
    })();
  }, []);

  useEffect(() => {
    if (adminResolved && !isAdmin) router.replace("/");
  }, [adminResolved, isAdmin, router]);

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    isAdmin ? (["admin-catalog"] as const) : null,
    () => withRequestTimeout(fetchAdminCatalog(), CATALOG_TIMEOUT_MS, USER_REQUEST_TIMEOUT_MESSAGE),
    { ...SWR_LIST_OPTIONS, keepPreviousData: true }
  );

  const releases = useMemo(() => data?.rows ?? [], [data?.rows]);
  const summary = useMemo(() => summarizeCatalog(releases), [releases]);
  const allTracks = useMemo(() => flattenCatalogTracks(releases), [releases]);
  const allArtists = useMemo(() => groupCatalogByArtist(releases), [releases]);
  const tracks = useMemo(() => allTracks.filter((t) => matchesCatalogTrack(t, query)), [allTracks, query]);
  const artists = useMemo(() => {
    const q = artistKey(query);
    return q ? allArtists.filter((a) => artistKey(a.name).includes(q)) : allArtists;
  }, [allArtists, query]);

  useEffect(() => {
    setVisibleCount(VISIBLE_CHUNK);
  }, [tab, query]);

  const errorMessage = errorToUserString(error);
  const showSkeleton = isLoading && data === undefined;
  const listLength = tab === "tracks" ? tracks.length : artists.length;

  if (adminResolved && !isAdmin) return null;

  if (userId == null && !isAdmin && process.env.NODE_ENV === "production") {
    return (
      <div className="mx-auto max-w-lg px-1 pt-10">
        <h1 className="text-[28px] font-extrabold tracking-[-0.03em]">Каталог</h1>
        <p className="mt-2 text-[15px] text-omf-graphite">Открой приложение из Telegram, чтобы попасть в админку.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-app max-w-lg px-1 pb-40 pt-6 text-omf-ink lg:max-w-3xl">
      <PullRefreshBrand onRefresh={() => void mutate(undefined, { revalidate: true })} />

      <header className="mb-5">
        <h1 className="text-[32px] font-bold leading-none tracking-[-0.045em]">Модерация</h1>
        <p className="mt-2 text-[14px] text-omf-graphite">Всё, что отгрузили на площадки</p>
      </header>
      <AdminTabs active="catalog" />

      {errorMessage && <p className="mb-4 text-[14px] text-omf-red">{errorMessage}</p>}
      {showSkeleton && <AdminModerationQueueSkeleton rows={4} />}

      {data ? (
        <dl className="mb-4 grid grid-cols-4 gap-1.5">
          {(
            [
              ["трека", summary.tracks],
              ["релиза", summary.releases],
              ["артиста", summary.artists],
              ["за месяц", summary.tracksThisMonth]
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-[14px] bg-omf-surface px-2.5 py-2.5">
              <dd className="text-[20px] font-bold leading-none tracking-[-0.02em] tabular-nums">{value}</dd>
              <dt className="mt-1 text-[11px] leading-tight text-omf-graphite">{label}</dt>
            </div>
          ))}
        </dl>
      ) : null}

      {data?.truncated ? (
        <p className="mb-4 text-[14px] text-omf-yellow">Показаны не все релизы — список упёрся в лимит.</p>
      ) : null}

      {releases.length > 0 ? (
        <>
          <div className="mb-4 flex gap-1" role="tablist" aria-label="Что показать">
            {(
              [
                { key: "tracks", label: "Треки", count: tracks.length },
                { key: "artists", label: "Артисты", count: artists.length }
              ] as const
            ).map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    hapticMap.impactLight();
                    setTab(t.key);
                  }}
                  className={cn(
                    "omf-focus shrink-0 rounded-full px-3.5 py-1.5 text-[13px] transition-colors",
                    active ? "bg-omf-surface-2 font-medium text-omf-ink" : "text-omf-graphite hover:text-omf-ink"
                  )}
                >
                  {t.label}
                  <span className={"ml-1.5 tabular-nums text-omf-faint"}>
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === "tracks" ? "Трек, релиз или артист" : "Артист"}
            aria-label="Поиск по каталогу"
            className="omf-focus mb-2 h-11 w-full rounded-[12px] bg-omf-surface px-3.5 text-[16px] text-omf-ink placeholder:text-omf-faint focus:outline-none focus:ring-1 focus:ring-omf-ultra"
          />
        </>
      ) : null}

      {!showSkeleton && !errorMessage && data && releases.length === 0 && (
        <div className="border-t border-omf-line pt-6">
          <p className="text-[18px] font-bold tracking-tight">Пока пусто</p>
          <p className="mt-1.5 text-[14px] text-omf-graphite">Здесь появятся треки, когда примешь первый релиз.</p>
        </div>
      )}

      {releases.length > 0 && listLength === 0 && (
        <p className="border-t border-omf-line pt-6 text-[14px] text-omf-graphite">Ничего не нашлось. Поменяй запрос.</p>
      )}

      {tab === "tracks" && tracks.length > 0 ? (
        <ul className="flex flex-col">
          {tracks.slice(0, visibleCount).map((t) => (
            <li key={t.key}>
              <Link
                href={adminReleaseHref(t.releaseId, "catalog")}
                className="omf-focus -mx-2 flex items-center gap-3 rounded-[14px] px-2 py-2.5 transition-colors hover:bg-omf-surface active:bg-omf-surface"
              >
                <div className="w-14 shrink-0">
                  <ReleaseSleeve
                    seed={t.releaseId}
                    title={t.releaseTitle}
                    artist={t.artist}
                    coverUrl={t.artworkUrl}
                    size="thumb"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[16px] font-semibold leading-tight tracking-[-0.01em]">{t.title}</span>
                    {t.explicit ? (
                      <span
                        className="shrink-0 rounded-[4px] bg-omf-surface-2 px-1 text-[10px] font-bold leading-[16px] text-omf-graphite"
                        title="Explicit"
                      >
                        E
                      </span>
                    ) : null}
                    {t.pitched ? (
                      <span
                        className="shrink-0 rounded-[4px] bg-omf-surface-2 px-1 text-[10px] font-semibold leading-[16px] text-omf-green"
                        title="Артист заполнил питчинг"
                      >
                        питчинг
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 truncate text-[13px] text-omf-graphite">
                    {t.artist}
                    {t.featuring.length > 0 ? ` feat. ${t.featuring.join(", ")}` : ""}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-omf-faint">
                    {t.releaseType === "single" ? "сингл" : `${TYPE_LABEL[t.releaseType].toLowerCase()} «${t.releaseTitle}»`}
                    , принят {formatAcceptedDate(t.acceptedAt)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {tab === "artists" && artists.length > 0 ? (
        <ul className="flex flex-col">
          {artists.slice(0, visibleCount).map((a) => (
            <li key={artistKey(a.name)}>
              <button
                type="button"
                onClick={() => {
                  hapticMap.impactLight();
                  setQuery(a.name);
                  setTab("tracks");
                  window.scrollTo({ top: 0 });
                }}
                className="omf-focus flex w-full items-center gap-3 border-b border-omf-line py-3.5 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-semibold leading-tight tracking-[-0.01em]">{a.name}</p>
                  <p className="mt-0.5 text-[13px] text-omf-graphite">
                    {a.releases} {pluralRu(a.releases, ["релиз", "релиза", "релизов"])}, последний{" "}
                    {formatAgoRu(a.lastAcceptedAt)}
                  </p>
                </div>
                <p className="shrink-0 text-right">
                  <span className="block text-[20px] font-bold leading-none tabular-nums">{a.tracks}</span>
                  <span className="text-[12px] text-omf-faint">{pluralRu(a.tracks, ["трек", "трека", "треков"])}</span>
                </p>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {visibleCount < listLength ? (
        <button
          type="button"
          onClick={() => setVisibleCount((n) => n + VISIBLE_CHUNK)}
          className="omf-btn-secondary mt-5 w-full"
        >
          Показать ещё ({visibleCount} из {listLength})
        </button>
      ) : null}
    </div>
  );
}
