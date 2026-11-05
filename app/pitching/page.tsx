"use client";

import { Suspense, useMemo, useState } from "react";
import useSWR from "swr";
import { AuthGuard } from "@/components/AuthGuard";
import { PitchingReleaseCard } from "@/components/PitchingReleaseCard";
import { PullRefreshBrand } from "@/components/PullRefreshBrand";
import { ScreenHeader } from "@/components/ScreenHeader";
import { LibraryReleaseSkeletonGrid } from "@/components/ui/LibrarySkeleton";
import { fetchPressKits } from "@/features/pitching/api";
import { useReleases } from "@/lib/hooks/useReleases";
import { isPitchingOpen, type PressKit } from "@/lib/press-kit";
import { SWR_LIST_OPTIONS } from "@/lib/swr-config";
import { getReleaseDisplayTitle } from "@/repositories/releases.repo";

function PitchingPageInner() {
  const { authReady, userId, releases, isBootstrapping, error } = useReleases();

  const open = useMemo(
    () =>
      releases
        .filter((r) => isPitchingOpen(r.status, r.smart_link))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [releases]
  );
  const ids = useMemo(() => open.map((r) => r.id), [open]);

  const {
    data: kits,
    error: kitsError,
    isLoading: kitsLoading,
    mutate
  } = useSWR(ids.length > 0 ? (["press-kits", ids.join(",")] as const) : null, () => fetchPressKits(ids), SWR_LIST_OPTIONS);
  const kitById = useMemo(() => new Map((kits ?? []).map((k) => [k.release_id, k])), [kits]);

  const [openId, setOpenId] = useState<string | null>(null);

  const onSaved = (kit: PressKit | null) => {
    if (!kit) return;
    void mutate((prev) => [...(prev ?? []).filter((k) => k.release_id !== kit.release_id), kit], {
      revalidate: false
    });
  };

  const showSkeleton = !authReady || userId == null || isBootstrapping || (ids.length > 0 && kitsLoading);
  const loadError = error ?? kitsError;

  return (
    <div className="mx-auto min-h-app w-full max-w-lg px-1 pb-40 pt-6 text-omf-ink">
      <PullRefreshBrand />
      <ScreenHeader
        title="Питчинг"
        intro="Покажем трек редакторам Яндекс Музыки, Сберзвука и VK. Нужны пара предложений и фото."
      />

      {loadError ? (
        <p className="mb-4 text-[14px] text-omf-red">
          {loadError instanceof Error ? loadError.message : "Не удалось загрузить релизы."}
        </p>
      ) : null}

      {showSkeleton ? (
        <LibraryReleaseSkeletonGrid count={3} variant="rows" />
      ) : open.length === 0 ? (
        <div className="border-t border-omf-line pt-6">
          <p className="text-[18px] font-bold tracking-tight">Пока нечего питчить</p>
          <p className="mt-1.5 text-[14px] leading-relaxed text-omf-graphite">
            Релиз появится здесь, когда модератор его выпустит и пришлёт ссылку BandLink. Тогда можно будет
            заполнить пресс-релиз.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {open.map((r) => (
            <PitchingReleaseCard
              key={r.id}
              releaseId={r.id}
              title={getReleaseDisplayTitle(r)}
              artist={(r.artist_name ?? "").trim() || "Артист"}
              coverUrl={r.artwork_url}
              kit={kitById.get(r.id) ?? null}
              open={openId === r.id}
              onToggle={() => setOpenId((cur) => (cur === r.id ? null : r.id))}
              onSaved={onSaved}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function PitchingPage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="min-h-app px-1 pb-40 pt-6">
            <div className="mx-auto max-w-lg space-y-6">
              <div className="h-24 animate-pulse rounded-control bg-omf-surface" />
              <LibraryReleaseSkeletonGrid count={3} variant="rows" />
            </div>
          </div>
        }
      >
        <PitchingPageInner />
      </Suspense>
    </AuthGuard>
  );
}
