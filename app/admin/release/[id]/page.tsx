"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, Send, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import { toast } from "sonner";
import { AudioPlayerLazy } from "@/components/AudioPlayerLazy";
import { AdminColleagueFormCopy } from "@/components/admin/AdminColleagueFormCopy";
import { AdminReleaseDownloads } from "@/components/admin/AdminReleaseDownloads";
import { AdminReleaseMetadataCard } from "@/components/admin/AdminReleaseMetadataCard";
import { AdminPaymentPanel } from "@/components/admin/AdminPaymentPanel";
import { AdminReleaseDatePanel } from "@/components/admin/AdminReleaseDatePanel";
import { AdminTakedownPanel } from "@/components/admin/AdminTakedownPanel";
import { AdminDeleteReleaseSheet } from "@/components/admin/AdminDeleteReleaseSheet";
import { AdminPressKitPanel } from "@/components/admin/AdminPressKitPanel";
import { isPitchingOpen, type PressKit } from "@/lib/press-kit";
import { ReleaseSleeve } from "@/components/ReleaseSleeve";
import { AdminApproveSmartLinkModal, type ApproveModalMode } from "@/components/AdminApproveSmartLinkModal";
import { AdminRejectModal } from "@/components/AdminRejectModal";
import { approveRelease, deleteRelease, publishReleaseWithSmartLink, rejectRelease } from "@/features/admin/actions";
import { fetchAdminReleaseDetail } from "@/features/admin/release-detail";
import type { ReleaseReferral } from "@/lib/server/referrals";
import { fetchAdminModerationQueue } from "@/features/admin/moderation-queue";
import {
  buildAdminReleaseSummary,
  pickNextReleaseId,
  pickPrevReleaseId,
  type AdminReleaseRow
} from "@/lib/admin-release-metadata";
import { useAdminHotkeys } from "@/lib/hooks/useAdminHotkeys";
import { useIsTelegramMiniApp } from "@/lib/hooks/useIsTelegramMiniApp";
import { SWR_LIST_OPTIONS } from "@/lib/swr-config";
import { cn } from "@/lib/utils";
import { hapticMap } from "@/lib/haptic-map";
import { openTelegramChat } from "@/lib/open-smart-link";
import { isAdminUi, isAdminUiByWebSession } from "@/lib/admin";
import { normalizeReleaseStatus } from "@/lib/release-status";
import type { ReleaseRecord, ReleaseTrackRow } from "@/repositories/releases.repo";
import { getReleaseDisplayTitle } from "@/repositories/releases/types";
import { getTelegramUserId, initTelegramWebApp, triggerHaptic } from "@/lib/telegram";
import { featuringNamesFromCollaboratorsJson } from "@/lib/collaborators";
import { describePreviousRejection } from "@/lib/rejection-reasons";
import { pluralRu } from "@/lib/release-next-step";

/** Статус строкой под артистом вместо наклейки на обложке. */
const ADMIN_STATUS_TEXT: Partial<Record<string, string>> = {
  draft: "Черновик",
  pending: "Не отправлен",
  processing: "На проверке",
  ready: "Принят",
  failed: "Вернули артисту",
  removed: "Снят с площадок"
};
const ADMIN_STATUS_TONE: Partial<Record<string, string>> = {
  processing: "text-omf-yellow",
  ready: "text-omf-green",
  failed: "text-omf-red",
  removed: "text-omf-graphite"
};


function buildAudioItems(release: ReleaseRecord, tracks: ReleaseTrackRow[]) {
  if (tracks.length > 0) {
    return tracks
      .filter((t) => t.file_path && t.file_path.length > 0)
      .map((t, i) => ({
        key: `${t.index}-${i}`,
        label: t.title.trim() || `Трек ${t.index + 1}`,
        src: t.file_path as string
      }));
  }
  if (release.audio_url) {
    return [
      {
        key: "main",
        label: release.track_name || "Трек",
        src: release.audio_url
      }
    ];
  }
  return [];
}

export default function AdminReleaseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const releaseId = params.id;

  const [userId, setUserId] = useState<number | null>(null);
  const [release, setRelease] = useState<ReleaseRecord | null>(null);
  const [referral, setReferral] = useState<ReleaseReferral | null>(null);
  const [pressKit, setPressKit] = useState<PressKit | null>(null);
  const [tracks, setTracks] = useState<ReleaseTrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveModal, setApproveModal] = useState<{ id: string; mode: ApproveModalMode } | null>(null);
  const [metaOpen, setMetaOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  /** Широкая раскладка только в веб-версии: в Telegram Desktop окно бывает широким, а контент — 450px и без сайдбара. */
  const wide = !useIsTelegramMiniApp();
  /** Панель решения — в портале: у обёртки страницы transform, `fixed` внутри неё уезжает под навигацию. */
  const [portalReady, setPortalReady] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    setPortalReady(true);
    initTelegramWebApp();
    setUserId(getTelegramUserId());
    setIsAdmin(isAdminUi());
    void (async () => {
      const webAdmin = await isAdminUiByWebSession();
      if (webAdmin) setIsAdmin(true);
    })();
  }, []);

  const load = useCallback(async () => {
    if (!releaseId || !isAdmin) return;
    setLoading(true);
    setLoadError(null);
    setRejectOpen(false);
    setApproveModal(null);
    setMetaOpen(false);
    setDeleteOpen(false);
    try {
      const { release: row, tracks: tr, referral: ref, pressKit: kit } = await fetchAdminReleaseDetail(releaseId);
      setRelease(row);
      setReferral(ref);
      setPressKit(kit);
      setTracks(tr);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Не удалось загрузить релиз.";
      setLoadError(msg);
      setRelease(null);
    } finally {
      setLoading(false);
    }
  }, [releaseId, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Тот же ключ, что у очереди на /admin: кэш общий, после решения сразу открываем следующий. */
  const { data: queue, mutate: mutateQueue } = useSWR(
    isAdmin ? (["admin-moderation-queue"] as const) : null,
    () => fetchAdminModerationQueue(),
    SWR_LIST_OPTIONS
  );
  const queueIds = useMemo(() => (queue ?? []).map((row) => row.release.id), [queue]);
  const remainingAfterThis = queueIds.filter((id) => id !== releaseId).length;

  /** После решения: убрать релиз из очереди и открыть следующий (или вернуться к пустой очереди). */
  const goNext = useCallback(
    async (decidedId: string, doneText: string) => {
      const nextId = pickNextReleaseId(queueIds, decidedId);
      void mutateQueue((rows) => rows?.filter((row) => row.release.id !== decidedId), { revalidate: true });
      if (nextId) {
        const left = queueIds.filter((id) => id !== decidedId).length;
        toast.success(`${doneText}. Осталось: ${left}`);
        router.replace(`/admin/release/${nextId}`);
        window.scrollTo({ top: 0 });
        return;
      }
      toast.success(`${doneText}. Очередь разобрана`);
      router.push("/admin");
    },
    [mutateQueue, queueIds, router]
  );

  const inQueue = queueIds.includes(releaseId);
  const openRelease = useCallback(
    (id: string | null) => {
      if (!id || id === releaseId) return;
      router.replace(`/admin/release/${id}`);
      window.scrollTo({ top: 0 });
    },
    [releaseId, router]
  );

  const handleAccept = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await approveRelease(id);
        triggerHaptic("success");
        setApproveModal(null);
        await goNext(id, "Принят");
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Не удалось принять релиз.");
      } finally {
        setBusy(false);
      }
    },
    [goNext]
  );

  /** Ссылка на пресейв: из очереди — принять сразу со ссылкой; у принятого — добавить ссылку. */
  const handleSubmitLink = useCallback(
    async (id: string, smartLink: string, upc: string, releaseDate: string, fromQueue: boolean) => {
      setBusy(true);
      try {
        await publishReleaseWithSmartLink(id, "RELEASED", smartLink, upc, releaseDate);
        triggerHaptic("success");
        setApproveModal(null);
        if (fromQueue) {
          await goNext(id, "Принят со ссылкой");
        } else {
          toast.success("Ссылка отправлена артисту");
          router.push("/admin");
        }
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Не удалось сохранить ссылку.");
      } finally {
        setBusy(false);
      }
    },
    [goNext, router]
  );

  const handleReject = useCallback(async (comment: string, reasonKeys: string[]) => {
    if (!release) return;
    setBusy(true);
    try {
      await rejectRelease(release.id, comment, reasonKeys);
      setRejectOpen(false);
      triggerHaptic("warning");
      await goNext(release.id, "Возвращено артисту");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Не удалось отклонить.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }, [release, goNext]);

  const handleDelete = useCallback(async () => {
    if (!release) return;
    setBusy(true);
    try {
      await deleteRelease(release.id);
      setDeleteOpen(false);
      void mutateQueue((rows) => rows?.filter((row) => row.release.id !== release.id), { revalidate: true });
      toast.success("Релиз удалён");
      router.replace("/admin");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Не удалось удалить релиз.");
    } finally {
      setBusy(false);
    }
  }, [release, mutateQueue, router]);

  const releaseCanModerate = release != null && normalizeReleaseStatus(release.status) === "processing";
  useAdminHotkeys(
    {
      approve: () => releaseCanModerate && setApproveModal({ id: releaseId, mode: "accept" }),
      reject: () => releaseCanModerate && setRejectOpen(true),
      next: () => openRelease(pickNextReleaseId(queueIds, releaseId)),
      prev: () => openRelease(pickPrevReleaseId(queueIds, releaseId))
    },
    isAdmin && inQueue && !loading && !busy && !rejectOpen && !deleteOpen && approveModal == null
  );

  if (userId == null && !isAdmin && process.env.NODE_ENV === "production") {
    return (
      <div className="mx-auto max-w-lg px-1 pt-10">
        <p className="text-[15px] text-omf-graphite">Открой приложение из Telegram.</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg px-1 pt-10">
        <p className="text-[15px] text-omf-graphite">Эта страница только для администратора.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-lg px-1 pt-10" aria-busy="true">
        <div className="mx-auto aspect-square w-[64%] max-w-[260px] animate-pulse rounded-sleeve bg-omf-surface" />
        <div className="mx-auto mt-6 h-7 w-1/2 animate-pulse rounded bg-omf-surface" />
      </div>
    );
  }

  if (loadError || !release) {
    return (
      <div className="mx-auto max-w-lg px-1 pt-10">
        <h1 className="text-[24px] font-extrabold tracking-[-0.03em]">Не получилось открыть релиз</h1>
        <p className="mt-2 text-[15px] text-omf-graphite">{loadError ?? "Такого релиза нет."}</p>
        <Link href="/admin" className="omf-btn-secondary mt-5 w-full">
          Вернуться к очереди
        </Link>
      </div>
    );
  }

  const canonical = normalizeReleaseStatus(release.status);
  const audioItems = buildAudioItems(release, tracks);
  const canModerate = canonical === "processing";
  const awaitingLink = canonical === "ready" && !(release.smart_link ?? "").trim();
  const displayTitle = getReleaseDisplayTitle(release);
  const featuringNames = featuringNamesFromCollaboratorsJson(release.collaborators);
  const previousRejection = describePreviousRejection(release);

  const summary = buildAdminReleaseSummary(release as AdminReleaseRow, tracks);
  const artistUsername = release.telegram_username?.trim().replace(/^@/, "") || null;
  const title = displayTitle || release.track_name || "Релиз";

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-lg px-1 pt-4 text-omf-ink",
        wide && "lg:max-w-5xl",
        canModerate ? "pb-44" : "pb-40"
      )}
    >
      <AdminRejectModal
        open={rejectOpen}
        busy={busy}
        onClose={() => setRejectOpen(false)}
        onSubmit={(comment, keys) => void handleReject(comment, keys)}
      />

      <AdminApproveSmartLinkModal
        releaseId={approveModal?.id ?? null}
        mode={approveModal?.mode ?? "accept"}
        paymentStatus={release?.payment_status ?? null}
        busy={approveModal != null && busy}
        onClose={() => setApproveModal(null)}
        onAccept={(id) => void handleAccept(id)}
        releaseDate={release?.release_date ?? null}
        onSubmitLink={(id, link, upc, date) => void handleSubmitLink(id, link, upc, date, approveModal?.mode !== "link")}
      />

      <AdminDeleteReleaseSheet
        target={
          deleteOpen
            ? { title, artist: release.artist_name, accepted: canonical === "ready" }
            : null
        }
        busy={busy}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void handleDelete()}
      />

      <div className="mb-4 flex items-center justify-between gap-3">
        <Link
          href="/admin"
          className="omf-focus -ml-2 inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[14px] text-omf-graphite transition-colors hover:text-omf-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Очередь
        </Link>
        {canModerate && queue ? (
          <p className="text-[13px] tabular-nums text-omf-graphite">
            {remainingAfterThis > 0 ? `После этого ещё ${remainingAfterThis}` : "Последний в очереди"}
          </p>
        ) : null}
      </div>

      <div className={cn(wide && "lg:grid lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start lg:gap-10")}>
        <div className={cn(wide && "lg:sticky lg:top-6")}>
          <header className={cn("flex items-start gap-4", wide && "lg:flex-col")}>
            <div className={cn("w-[112px] shrink-0", wide && "lg:w-full lg:max-w-[360px]")}>
              <ReleaseSleeve
                seed={release.id}
                title={title}
                artist={release.artist_name}
                coverUrl={release.artwork_url}
                priority
              />
            </div>
            <div className="min-w-0 flex-1 pt-1">
              <h1 className="break-words text-[22px] font-bold leading-[1.1] tracking-[-0.03em]">{title}</h1>
              <p className="mt-1.5 text-[15px] text-omf-graphite">{release.artist_name}</p>
              {featuringNames.length > 0 ? (
                <p className="mt-0.5 truncate text-[13px] text-omf-graphite" title={featuringNames.join(", ")}>
                  feat. {featuringNames.join(", ")}
                </p>
              ) : null}
              <p className={cn("mt-2 text-[13px] font-medium", ADMIN_STATUS_TONE[canonical] ?? "text-omf-graphite")}>
                {ADMIN_STATUS_TEXT[canonical] ?? "Статус не определён"}
              </p>
              {summary.length > 0 ? (
                <p className="mt-1 text-[13px] leading-snug text-omf-faint">{summary.join(" · ")}</p>
              ) : null}
              {artistUsername ? (
                <button
                  type="button"
                  onClick={() => {
                    hapticMap.impactLight();
                    openTelegramChat(artistUsername);
                  }}
                  className="omf-focus mt-2 inline-flex items-center gap-1.5 rounded-full py-1 text-[14px] text-omf-ultra-text hover:text-omf-ink"
                >
                  <Send className="h-4 w-4" aria-hidden />
                  Написать @{artistUsername}
                </button>
              ) : null}
            </div>
          </header>

          {previousRejection ? (
            <aside
              role="note"
              aria-labelledby="admin-prev-rejection"
              className="mt-6 rounded-control border border-omf-yellow p-4"
            >
              <p id="admin-prev-rejection" className="text-[14px] font-bold text-omf-yellow">
                Повторная отправка
                {previousRejection.count > 1
                  ? `: вернули уже ${previousRejection.count} ${pluralRu(previousRejection.count, ["раз", "раза", "раз"])}`
                  : ""}
              </p>
              {release.admin_notes?.trim() ? (
                <>
                  <p className="mt-1.5 text-[13px] text-omf-graphite">В прошлый раз написали артисту:</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-omf-ink">
                    {release.admin_notes.trim()}
                  </p>
                </>
              ) : null}
              <p className="mt-2 text-[13px] text-omf-graphite">Сначала проверь, что это исправлено.</p>
            </aside>
          ) : null}

          {/* Артист попросил удалить — показываем сразу, до остальных блоков. */}
          {release.takedown_requested_at || release.status === "removed" ? (
            <AdminTakedownPanel
              release={release}
              onChange={(fields) => setRelease((prev) => (prev ? { ...prev, ...fields } : prev))}
            />
          ) : null}

          <div className="mt-6 border-t border-omf-line">
          <AdminReleaseDatePanel
            release={release}
            onChange={(fields) => setRelease((prev) => (prev ? { ...prev, ...fields } : prev))}
          />

          <AdminPaymentPanel
            release={release}
            referral={referral}
            onReferralChange={setReferral}
            onChange={(fields) => {
              setRelease((prev) => (prev ? { ...prev, ...fields } : prev));
              // «Оплачено» открывает выплату пригласившему — подтянуть свежие сведения.
              void fetchAdminReleaseDetail(release.id)
                .then((d) => setReferral(d.referral))
                .catch(() => {});
            }}
          />
          </div>

          <section className="mt-6" aria-labelledby="admin-listen">
            <h2 id="admin-listen" className="mb-2 text-[14px] font-semibold text-omf-graphite">
              Послушать
            </h2>
            {audioItems.length === 0 ? (
              <p className="text-[14px] text-omf-graphite">Аудио в базе нет, послушать нечего.</p>
            ) : (
              <div className="space-y-2.5">
                {audioItems.map((item) => (
                  <AudioPlayerLazy key={item.key} src={item.src} label={item.label} variant="admin" />
                ))}
              </div>
            )}
          </section>

        </div>

        <div className={cn(wide && "lg:pt-1")}>
          <section className={cn("mt-6 border-t border-omf-line", wide && "lg:mt-0")} aria-labelledby="admin-meta">
            <button
              type="button"
              id="admin-meta"
              aria-expanded={metaOpen}
              aria-controls="admin-meta-body"
              onClick={() => setMetaOpen((v) => !v)}
              className={cn(
                "omf-focus flex w-full items-center justify-between py-3.5 text-left text-[15px] font-medium",
                wide && "lg:pointer-events-none"
              )}
            >
              Все данные релиза
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-omf-graphite transition-transform motion-reduce:transition-none",
                  wide && "lg:hidden",
                  metaOpen && "rotate-180"
                )}
                aria-hidden
              />
            </button>
            {/* На широком экране места хватает — данные видны сразу. */}
            <div id="admin-meta-body" className={cn("pb-2", metaOpen ? "block" : "hidden", wide && "lg:block")}>
              <AdminReleaseMetadataCard release={release} tracks={tracks} />
            </div>
          </section>

          {isPitchingOpen(release.status, release.smart_link) ? (
            <AdminPressKitPanel
              releaseId={release.id}
              kit={pressKit}
              hasArtwork={Boolean(release.artwork_url?.trim())}
            />
          ) : null}

          <section className="mt-2 border-t border-omf-line pt-4" aria-labelledby="admin-files">
            <h2 id="admin-files" className="mb-2.5 text-[14px] font-semibold text-omf-graphite">
              Коллегам и файлы
            </h2>
            <div className="mb-3">
              <AdminColleagueFormCopy release={release} tracks={tracks} />
            </div>
            <AdminReleaseDownloads
              releaseId={release.id}
              hasArtwork={Boolean(release.artwork_url?.trim())}
              tracks={tracks}
              legacyAudioUrl={release.audio_url}
              releaseLyrics={release.lyrics ?? null}
            />
          </section>

          {!release.takedown_requested_at && release.status !== "removed" ? (
            <AdminTakedownPanel
              release={release}
              onChange={(fields) => setRelease((prev) => (prev ? { ...prev, ...fields } : prev))}
            />
          ) : null}

          {/* Тестовые и дубли: удалить насовсем. Внизу и неярко — чтобы не нажать вместо «Вернуть». */}
          <section className="mt-8 border-t border-omf-line pt-4" aria-label="Удаление">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                hapticMap.impactLight();
                setDeleteOpen(true);
              }}
              className="omf-focus -ml-1 inline-flex items-center gap-1.5 rounded-full px-1 py-1.5 text-[14px] text-omf-red hover:text-omf-ink disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Удалить релиз
            </button>
            <p className="mt-0.5 text-[13px] text-omf-faint">Для тестовых и дублей. Насовсем, артисту ничего не придёт.</p>
          </section>
        </div>
      </div>

      {canModerate && portalReady ? (
        createPortal(
          <div
            role="group"
            aria-label="Решение по релизу"
            className={cn(
              "fixed inset-x-0 bottom-0 z-[60] border-t border-omf-line bg-omf-bg pb-[env(safe-area-inset-bottom,0px)]",
              wide && "lg:left-64"
            )}
          >
            <div className={cn("mx-auto flex max-w-lg items-center gap-2.5 px-4 py-3", wide && "lg:max-w-5xl")}>
              {inQueue && wide ? (
                <p className="mr-auto hidden text-[13px] text-omf-faint lg:block">
                  <kbd className="font-sans text-omf-graphite">A</kbd> принять ·{" "}
                  <kbd className="font-sans text-omf-graphite">R</kbd> вернуть ·{" "}
                  <kbd className="font-sans text-omf-graphite">J</kbd> /{" "}
                  <kbd className="font-sans text-omf-graphite">K</kbd> следующий / предыдущий
                </p>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  triggerHaptic("light");
                  setRejectOpen(true);
                }}
                className={cn("omf-btn-secondary flex-1 disabled:opacity-50", wide && "lg:w-44 lg:flex-none")}
              >
                Вернуть
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  triggerHaptic("light");
                  setApproveModal({ id: release.id, mode: "accept" });
                }}
                className={cn("omf-btn-ink flex-1 disabled:opacity-50", wide && "lg:w-44 lg:flex-none")}
              >
                Принять
              </button>
            </div>
          </div>,
          document.body
        )
      ) : canModerate ? null : awaitingLink ? (
        <section className="mt-8 border-t border-omf-line pt-6" aria-labelledby="admin-awaiting">
          <h2 id="admin-awaiting" className="text-[16px] font-bold tracking-tight">
            Принят, ждёт ссылку
          </h2>
          <p className="mt-1.5 text-[14px] leading-relaxed text-omf-graphite">
            Релиз ушёл на площадки. Когда придёт UPC и будет готов BandLink, добавь ссылку — артист получит её в боте.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              triggerHaptic("light");
              setApproveModal({ id: release.id, mode: "link" });
            }}
            className="omf-btn-primary mt-4 w-full disabled:opacity-50"
          >
            Добавить ссылку
          </button>
        </section>
      ) : (
        <p className="mt-8 border-t border-omf-line pt-6 text-[14px] leading-relaxed text-omf-graphite">
          Релиз сейчас не «на проверке», поэтому решение здесь принять нельзя.
        </p>
      )}
    </div>
  );
}
