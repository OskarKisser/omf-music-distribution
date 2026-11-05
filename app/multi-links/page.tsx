"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SmartLinkHero } from "@/components/links/SmartLinkHero";
import { ReleaseSleeve } from "@/components/ReleaseSleeve";
import { normalizeReleaseStatus } from "@/lib/release-status";
import { DSP_REVIEW_DAYS_TEXT } from "@/lib/release-next-step";
import { AuthGuard } from "@/components/AuthGuard";
import { MultiLinkReleaseRow } from "@/components/MultiLinkReleaseRow";
import { PullRefreshBrand } from "@/components/PullRefreshBrand";
import { ScreenHeader } from "@/components/ScreenHeader";
import { LibraryReleaseSkeletonGrid } from "@/components/ui/LibrarySkeleton";
import { getReleaseDisplayTitle } from "@/repositories/releases.repo";
import { useReleases } from "@/lib/hooks/useReleases";
import { prepareNewReleaseDraft } from "@/features/release/createRelease/store";
import { shouldShowSmartLinkCta } from "@/lib/smart-link-cta";
import { hapticMap } from "@/lib/haptic-map";
import { cn } from "@/lib/utils";

type SortMode = "date_desc" | "date_asc" | "title";

const SORT_OPTIONS: { id: SortMode; label: string }[] = [
  { id: "date_desc", label: "Сначала новые" },
  { id: "date_asc", label: "Сначала старые" },
  { id: "title", label: "По названию" }
];

/** Поиск и сортировка нужны, когда ссылок много; на коротком списке всё видно сразу. */
const SEARCH_MIN_LINKS = 6;

function normalizeSearch(s: string): string {
  return s.trim().toLowerCase();
}

function MultiLinksPageInner() {
  const router = useRouter();
  const {
    authReady,
    userId,
    releases,
    isBootstrapping,
    error,
    isValidating
  } = useReleases();

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("date_desc");

  const withLinks = useMemo(() => {
    return releases.filter(
      (r) => shouldShowSmartLinkCta(r.status, r.smart_link) && (r.smart_link?.trim() ?? "").length > 0
    );
  }, [releases]);

  const filtered = useMemo(() => {
    const q = normalizeSearch(query);
    let rows = withLinks;
    if (q) {
      rows = rows.filter((r) => {
        const title = normalizeSearch(getReleaseDisplayTitle(r));
        const artist = normalizeSearch(r.artist_name ?? "");
        const link = normalizeSearch(r.smart_link ?? "");
        return title.includes(q) || artist.includes(q) || link.includes(q);
      });
    }
    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (sort === "title") {
        return getReleaseDisplayTitle(a).localeCompare(getReleaseDisplayTitle(b), "ru");
      }
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sort === "date_desc" ? tb - ta : ta - tb;
    });
    return sorted;
  }, [withLinks, query, sort]);

  const showSkeleton = !authReady || userId == null || isBootstrapping;
  const searching = normalizeSearch(query).length > 0;
  /** Самая свежая ссылка — крупно; при поиске показываем просто список совпадений. */
  const hero = !searching && sort === "date_desc" ? filtered[0] ?? null : null;
  const rest = hero ? filtered.slice(1) : filtered;
  /** Приняты, но ссылки ещё нет, или на проверке — чтобы было видно, что ссылки скоро будут. */
  const upcoming = useMemo(
    () =>
      releases.filter((r) => {
        const s = normalizeReleaseStatus(r.status);
        return (s === "ready" && !(r.smart_link?.trim() ?? "")) || s === "processing";
      }),
    [releases]
  );

  return (
    <div className="mx-auto min-h-app w-full max-w-lg px-1 pb-40 pt-6 text-omf-ink">
      <PullRefreshBrand />
      <ScreenHeader
        title="Ссылки"
        intro="Одна ссылка на все площадки — отправь слушателям в день выхода."
      />

      {withLinks.length >= SEARCH_MIN_LINKS ? (
        <>
          <div className="mb-4">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Название или артист"
              aria-label="Поиск по ссылкам"
              className="omf-focus min-h-[48px] w-full rounded-control border border-omf-line bg-omf-surface px-4 py-3 text-[16px] text-omf-ink outline-none placeholder:text-omf-faint focus:border-omf-ultra"
              autoComplete="off"
            />
          </div>

          <div
            className="mb-4 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="tablist"
            aria-label="Порядок"
          >
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={sort === opt.id}
                onClick={() => {
                  hapticMap.impactLight();
                  setSort(opt.id);
                }}
                className={cn(
                  "omf-focus shrink-0 rounded-full px-3.5 py-1.5 text-[13px] transition-colors",
                  sort === opt.id ? "bg-omf-ink font-medium text-omf-bg" : "text-omf-graphite hover:text-omf-ink"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {error && (
        <p className="mb-4 text-[14px] text-omf-red">
          {error instanceof Error ? error.message : "Не удалось загрузить релизы."}
        </p>
      )}

      {showSkeleton ? (
        <LibraryReleaseSkeletonGrid count={4} variant="rows" />
      ) : filtered.length === 0 ? (
        <div className="border-t border-omf-line pt-6">
          <p className="text-[18px] font-bold tracking-tight">
            {withLinks.length === 0 ? "Ссылок пока нет" : "Ничего не нашлось"}
          </p>
          <p className="mt-1.5 text-[14px] leading-relaxed text-omf-graphite">
            {withLinks.length === 0
              ? "Ссылка появится здесь, когда модератор одобрит релиз и площадки его опубликуют."
              : "Попробуй другое название или имя артиста."}
          </p>
          {withLinks.length === 0 && upcoming.length === 0 && (
            <button
              onClick={() => {
                prepareNewReleaseDraft();
                router.push("/create/metadata");
              }}
              className="omf-btn-primary mt-5 w-full"
            >
              Создать релиз
            </button>
          )}
        </div>
      ) : (
        <>
          {hero ? (
            <SmartLinkHero
              releaseId={hero.id}
              title={getReleaseDisplayTitle(hero)}
              artist={(hero.artist_name ?? "").trim() || "Артист"}
              smartLink={hero.smart_link!.trim()}
              coverUrl={hero.artwork_url}
              releaseType={hero.release_type}
              releaseDate={hero.release_date}
            />
          ) : null}
          {rest.length > 0 ? (
            <section aria-labelledby={hero ? "links-more" : undefined}>
              {hero ? (
                <h2 id="links-more" className="mb-1 text-[15px] font-semibold text-omf-graphite">
                  Другие ссылки
                </h2>
              ) : null}
              <div className="flex flex-col gap-1">
                {rest.map((r, i) => (
                  <MultiLinkReleaseRow
                    key={r.id}
                    releaseId={r.id}
                    title={getReleaseDisplayTitle(r)}
                    artist={(r.artist_name ?? "").trim() || "Артист"}
                    smartLink={r.smart_link!.trim()}
                    coverUrl={r.artwork_url}
                    index={i}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      {!showSkeleton && !searching && upcoming.length > 0 ? (
        <section aria-labelledby="links-soon" className="mt-8">
          <h2 id="links-soon" className="mb-1 text-[15px] font-semibold text-omf-graphite">
            Скоро
          </h2>
          <ul className="flex flex-col">
            {upcoming.map((r) => {
              const waiting = normalizeReleaseStatus(r.status) === "processing";
              return (
                <li key={r.id}>
                  <Link
                    href={`/release/${r.id}`}
                    className="omf-focus -mx-2 grid grid-cols-[48px_1fr] items-center gap-3.5 rounded-[14px] px-2 py-2 transition-colors hover:bg-omf-surface"
                  >
                    <span className="block w-12">
                      <ReleaseSleeve
                        seed={r.id}
                        title={getReleaseDisplayTitle(r)}
                        artist={r.artist_name}
                        coverUrl={r.artwork_url}
                        size="thumb"
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[16px] font-semibold tracking-[-0.01em]">
                        {getReleaseDisplayTitle(r) || "Без названия"}
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] text-omf-graphite">
                        {waiting
                          ? "На проверке — ссылка после приёма"
                          : `На площадках — ссылка через ${DSP_REVIEW_DAYS_TEXT}`}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {!showSkeleton && isValidating ? (
        <p className="mt-6 text-center text-[13px] text-omf-faint">Обновляем…</p>
      ) : null}
    </div>
  );
}

export default function MultiLinksPage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="min-h-app px-1 pb-40 pt-6">
            <div className="mx-auto max-w-lg space-y-6">
              <div className="h-24 animate-pulse rounded-control bg-omf-surface" />
              <LibraryReleaseSkeletonGrid count={4} variant="rows" />
            </div>
          </div>
        }
      >
        <MultiLinksPageInner />
      </Suspense>
    </AuthGuard>
  );
}
