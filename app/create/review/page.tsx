"use client";

import { isLicenseType, LICENSE_TYPE_LABELS } from "@/lib/release-rights";
import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { WizardActionBar } from "@/features/release/createRelease/components/WizardActionBar";
import { CreateShell } from "@/features/release/createRelease/components/CreateShell";
import { hapticMap } from "@/lib/haptic-map";
import { StepGate } from "@/features/release/createRelease/components/StepGate";
import { useStepGuard } from "@/features/release/createRelease/guards";
import {
  selectTracksWavFullySynced,
  useCreateReleaseDraftStore
} from "@/features/release/createRelease/store";
import {
  getLastSubmitPrecheckHttpStatus,
  submitTracksAndFinalize
} from "@/features/release/createRelease/actions";
import { getTelegramApiAuthHeaders, getTelegramInitDataForApiHeader } from "@/lib/telegram";
import { logClientError } from "@/lib/logger";
import {
  acquireTelegramClosingConfirmation,
  releaseTelegramClosingConfirmation,
  triggerHaptic
} from "@/lib/telegram";
import {
  PERFORMANCE_LANGUAGE_LABELS,
  type PerformanceLanguage
} from "@/lib/performance-language";
import { unionFeaturingNamesFromTracks } from "@/lib/collaborators";
import { useReferral } from "@/lib/hooks/useReferral";
import { REFEREE_DISCOUNT_RUB, formatRub } from "@/lib/referral";
import { BusyLabel } from "@/components/BusyLabel";
import { cn } from "@/lib/utils";

const UploadProgress = dynamic(
  () => import("@/components/UploadProgress").then((m) => m.UploadProgress),
  { ssr: false }
);
const FullScreenLoader = dynamic(
  () => import("@/components/FullScreenLoader").then((m) => m.FullScreenLoader),
  { ssr: false }
);

function formatReleaseDateBadge(iso: string | undefined): string {
  const d = iso?.trim();
  if (!d) return "—";
  const parsed = new Date(`${d}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed
    .toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric"
    })
    .replace(/\s*г\.?$/, "");
}

const RELEASE_TYPE_RU: Record<string, string> = {
  single: "Сингл",
  ep: "EP",
  album: "Альбом"
};

export default function CreateReviewPage() {
  const router = useRouter();
  const guard = useStepGuard("review");

  const releaseId = useCreateReleaseDraftStore((s) => s.releaseId);
  const metadata = useCreateReleaseDraftStore((s) => s.metadata);
  const artworkUrl = useCreateReleaseDraftStore((s) => s.artworkUrl);
  const tracks = useCreateReleaseDraftStore((s) => s.tracks);
  const trackFiles = useCreateReleaseDraftStore((s) => s.trackFiles);
  const trackAudioUrlsFromDb = useCreateReleaseDraftStore((s) => s.trackAudioUrlsFromDb);
  const submitError = useCreateReleaseDraftStore((s) => s.submitError);
  const setSubmitError = useCreateReleaseDraftStore((s) => s.setSubmitError);
  const submitStatus = useCreateReleaseDraftStore((s) => s.submitStatus);
  const successSummary = useCreateReleaseDraftStore((s) => s.successSummary);
  const submitStage = useCreateReleaseDraftStore((s) => s.submitStage);
  const submitProgress = useCreateReleaseDraftStore((s) => s.submitProgress);
  const tracksWavSyncedToDb = useCreateReleaseDraftStore(selectTracksWavFullySynced);
  const tracksUploadInProgress = useCreateReleaseDraftStore((s) => s.tracksUploadInProgress);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  /** Артист подтвердил: в треках и текстах нет пропаганды наркотиков (или она запикана). */
  const [contentAccepted, setContentAccepted] = useState(false);
  const { data: referral } = useReferral();
  /** Нажали «Отправить» без галочки — подсвечиваем её вместо неактивной кнопки. */
  const [termsHint, setTermsHint] = useState(false);
  const [progressDismissed, setProgressDismissed] = useState(false);
  const prevSubmitErrorRef = useRef<string | null>(null);

  const missingFiles = useMemo(() => {
    if (tracksWavSyncedToDb) return false;
    return tracks.some((_t, i) => !trackFiles[i]);
  }, [tracksWavSyncedToDb, trackFiles, tracks]);
  const submitBlocked =
    missingFiles ||
    tracksUploadInProgress ||
    isSubmitting ||
    submitStatus === "submitting" ||
    submitStatus === "success";

  const stageLabel = useMemo(() => {
    if (submitStage === "preparing") return "Подготавливаем релиз";
    if (submitStage === "uploading_tracks")
      return `Загрузка WAV ${Math.round(submitProgress)}%`;
    if (submitStage === "finalizing") return "Передаем релиз в модерацию";
    if (submitStage === "done") return "Готово";
    if (submitStage === "error") return "Ошибка отправки";
    return "Ожидание отправки";
  }, [submitStage, submitProgress]);

  const showProgressPanel =
    submitStatus === "submitting" ||
    submitStatus === "error" ||
    (submitStatus === "success" && !progressDismissed);

  const progressActive = isSubmitting || submitStatus === "submitting";

  const releaseTitle = metadata.releaseTitle?.trim() || "Релиз";
  const artistName = metadata.primaryArtist?.trim() || "Артист";
  const featuringLine = useMemo(
    () => unionFeaturingNamesFromTracks(tracks).join(", "),
    [tracks]
  );

  useEffect(() => {
    if (submitStatus === "success") {
      const t = window.setTimeout(() => setProgressDismissed(true), 450);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [submitStatus]);

  useEffect(() => {
    const busy = isSubmitting || submitStatus === "submitting";
    if (!busy) return;
    acquireTelegramClosingConfirmation();
    return () => releaseTelegramClosingConfirmation();
  }, [isSubmitting, submitStatus]);

  useEffect(() => {
    if (submitError && submitError !== prevSubmitErrorRef.current) {
      const isFileRelated = /wav|файл|загруз/i.test(submitError);
      if (isFileRelated) {
        hapticMap.notificationError();
      }
    }
    prevSubmitErrorRef.current = submitError;
  }, [submitError]);

  const handleSubmit = useCallback(async () => {
    if (!termsAccepted || !contentAccepted) {
      setTermsHint(true);
      hapticMap.notificationError();
      return;
    }
    setSubmitError(null);
    setProgressDismissed(false);
    if (missingFiles) {
      const msg =
        "Не хватает WAV-файлов в этой сессии. Загрузите их на шаге «Треки» — даже если в базе уже есть старые файлы.";
      setSubmitError(msg);
      hapticMap.notificationError();
      toast.error(msg);
      logClientError({
        error: new Error("review_precheck_missing_wav"),
        screenName: "CreateReview_precheck",
        route: "/create/review",
        extra: { phase: "precheck", kind: "missing_session_wav" }
      });
      return;
    }
    hapticMap.notificationSuccess();
    const files = trackFiles.filter(Boolean) as File[];
    setIsSubmitting(true);
    let ok = false;
    try {
      ok = await submitTracksAndFinalize({ files, termsAccepted });
    } finally {
      setIsSubmitting(false);
    }
    if (!ok) {
      const st = useCreateReleaseDraftStore.getState();
      const msg = st.submitError;
      const precheckStatus = getLastSubmitPrecheckHttpStatus();
      const storeUid = st.userId
        ? Number(st.userId)
        : undefined;
      const authHeaders = getTelegramApiAuthHeaders(
        storeUid != null && Number.isFinite(storeUid) && storeUid > 0
          ? { userId: storeUid }
          : undefined
      );
      const authDebug = {
        note:
          "Authorization не используется; для API нужны X-Telegram-Init-Data и/или (в dev) X-Dev-Telegram-User-Id — см. Network.",
        xTelegramInitDataLength: getTelegramInitDataForApiHeader().length,
        xTelegramInitDataPreview: getTelegramInitDataForApiHeader().slice(0, 320),
        devUserIdHeader: authHeaders["X-Dev-Telegram-User-Id"] ?? null,
        storeUserId: st.userId
      };
      console.error("[CreateReview] submitTracksAndFinalize failed", {
        submitError: msg,
        submitStage: st.submitStage,
        submitStatus: st.submitStatus,
        releaseId: st.releaseId,
        clientRequestId: st.clientRequestId,
        userId: st.userId,
        lastSubmitPrecheckHttpStatus: precheckStatus
      });
      if (
        precheckStatus === 401 ||
        msg === "Unauthorized" ||
        (typeof msg === "string" && msg.includes("подтвердить сессию"))
      ) {
        console.error("[CreateReview] 401 / Telegram auth debug (full)", authDebug);
        alert(
          `401 / Telegram auth\n\n${authDebug.note}\n\ninitData length: ${authDebug.xTelegramInitDataLength}\npreview (truncated):\n${authDebug.xTelegramInitDataPreview}\n\nstore userId: ${String(authDebug.storeUserId)}\nX-Dev-Telegram-User-Id (dev): ${authDebug.devUserIdHeader ?? "—"}`
        );
      }
      const toastText = msg ?? "Не удалось отправить релиз на модерацию. Статус не изменён.";
      hapticMap.notificationError();
      toast.error(toastText);
      logClientError({
        error: new Error(toastText),
        screenName: "CreateReview_submitResult",
        route: "/create/review",
        extra: {
          phase: "after_submitTracksAndFinalize",
          submitStage: st.submitStage,
          submitStatus: st.submitStatus,
          detailLoggedInActions: true
        }
      });
      return;
    }
    router.replace("/create/success");
  }, [missingFiles, setSubmitError, trackFiles, router, termsAccepted, contentAccepted]);

  if (submitStatus === "success" && successSummary) {
    return (
      <CreateShell title="Проверка">
        <FullScreenLoader state="composing" label="Готово — переходим…" />
      </CreateShell>
    );
  }

  if (!guard.allowed) {
    if (guard.title === "Загрузка…") {
      return (
        <CreateShell title="Проверка">
          <FullScreenLoader />
        </CreateShell>
      );
    }
    if (isSubmitting || submitStatus === "submitting") {
      return (
        <CreateShell title="Проверка">
          <FullScreenLoader state="weaving" label="Отправляем релиз…" />
        </CreateShell>
      );
    }
    return (
      <CreateShell title="Проверка">
        <StepGate
          title={guard.title}
          description={guard.description}
          actionLabel={guard.actionLabel}
          onAction={() => router.push(`/create/${guard.redirectTo}`)}
        />
      </CreateShell>
    );
  }

  const languageLabel =
    PERFORMANCE_LANGUAGE_LABELS[metadata.language as PerformanceLanguage] ?? metadata.language;
  const passportSummary = [
    RELEASE_TYPE_RU[metadata.releaseType] ?? metadata.releaseType,
    metadata.genre?.trim() || "жанр не выбран",
    languageLabel?.toLowerCase(),
    metadata.explicit ? "есть мат" : "без мата",
    `выходит ${formatReleaseDateBadge(metadata.releaseDate)}`
  ]
    .filter(Boolean)
    .join(", ");
  const rightsSummary = [
    metadata.authorFullName?.trim() || "ФИО не указано",
    metadata.musicAuthor?.trim() ? `бит: ${metadata.musicAuthor.trim()}` : "автор бита не указан",
    isLicenseType(metadata.licenseType) ? LICENSE_TYPE_LABELS[metadata.licenseType].toLowerCase() : null,
    metadata.tiktokStart?.trim() ? `отрывок с ${metadata.tiktokStart.trim()}` : null,
    featuringLine ? `участники: ${featuringLine}` : null
  ]
    .filter(Boolean)
    .join(", ");

  const trackStates = tracks.map((t, i) => {
    const hasFile = Boolean(trackFiles[i]);
    const dbUrl = trackAudioUrlsFromDb[i] ?? null;
    const ok = tracksWavSyncedToDb || hasFile;
    const note = tracksWavSyncedToDb ? "аудио на сервере" : hasFile ? "файл выбран" : dbUrl ? "выбери файл заново" : "нет аудио";
    return { title: t.title || "Без названия", ok, note };
  });
  const tracksHaveProblem = trackStates.some((t) => !t.ok);

  const editLink = (href: string, label: string) => (
    <Link
      href={href}
      onClick={() => triggerHaptic("light")}
      aria-label={label}
      className="omf-focus shrink-0 rounded-full text-[13px] text-omf-ultra-text hover:text-omf-ink"
    >
      Изменить
    </Link>
  );

  return (
    <CreateShell title="Проверка">
      <div className="space-y-5">
        <div className="flex flex-col gap-2">
          <section aria-labelledby="review-passport" className="rounded-[16px] bg-omf-surface px-4 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <h3 id="review-passport" className="text-[14.5px] font-semibold text-omf-ink">
                Паспорт
              </h3>
              {editLink("/create/metadata", "Изменить паспорт")}
            </div>
            <p className="mt-1 text-[13px] leading-snug text-omf-graphite">{passportSummary}</p>
          </section>

          <section aria-labelledby="review-rights" className="rounded-[16px] bg-omf-surface px-4 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <h3 id="review-rights" className="text-[14.5px] font-semibold text-omf-ink">
                Авторство и права
              </h3>
              {editLink("/create/metadata", "Изменить авторство и права")}
            </div>
            <p className="mt-1 text-[13px] leading-snug text-omf-graphite">{rightsSummary}</p>
          </section>

          {!artworkUrl ? (
            <section className="rounded-[16px] bg-omf-surface px-4 py-3.5 shadow-[inset_0_0_0_1px_rgba(229,72,77,0.45)]">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[14.5px] font-semibold text-omf-ink">Обложка</h3>
                {editLink("/create/assets", "Загрузить обложку")}
              </div>
              <p className="mt-1 text-[13px] text-[#ff8a8d]">Обложка не загружена</p>
            </section>
          ) : null}

          <section
            aria-labelledby="review-tracks"
            className={cn(
              "rounded-[16px] bg-omf-surface px-4 py-3.5",
              tracksHaveProblem && "shadow-[inset_0_0_0_1px_rgba(229,72,77,0.45)]"
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 id="review-tracks" className="min-w-0 truncate text-[14.5px] font-semibold text-omf-ink">
                {trackStates.length > 1 ? `Треки, ${trackStates.length}` : `Трек: ${trackStates[0]?.title ?? ""}`}
              </h3>
              {editLink("/create/tracks", "Изменить треки")}
            </div>
            {trackStates.length > 1 ? (
              <ol className="mt-1.5">
                {trackStates.map((t, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <li key={i} className="flex min-w-0 items-baseline gap-3 py-1 text-[13.5px]">
                    <span className="w-4 shrink-0 tabular-nums text-omf-faint">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-omf-ink">{t.title}</span>
                    <span className={cn("shrink-0 text-[12.5px]", t.ok ? "text-omf-graphite" : "text-[#ff8a8d]")}>
                      {t.note}
                    </span>
                  </li>
                ))}
              </ol>
            ) : trackStates[0]?.ok ? (
              <p className="mt-1 text-[13px] text-omf-graphite">{trackStates[0].note}</p>
            ) : null}
            {missingFiles ? (
              <p className="mt-2 flex items-start gap-1.5 text-[13px] leading-snug text-[#ff8a8d]">
                <AlertCircle className="mt-[1px] h-[15px] w-[15px] shrink-0" aria-hidden />
                Выбери WAV заново: после черновика файл не сохраняется
              </p>
            ) : null}
          </section>
        </div>

        {!progressActive ? (
          <div>
            <label className="mb-3.5 flex cursor-pointer items-start gap-3 text-[13px] leading-snug text-omf-graphite">
              <input
                type="checkbox"
                checked={contentAccepted}
                disabled={isSubmitting}
                aria-invalid={termsHint && !contentAccepted}
                onChange={(e) => {
                  triggerHaptic("light");
                  setContentAccepted(e.target.checked);
                  if (e.target.checked && termsAccepted) setTermsHint(false);
                }}
                className="mt-0.5 h-5 w-5 shrink-0 rounded-[6px] accent-[var(--omf-ultra)]"
              />
              <span>
                В треках и текстах нет пропаганды наркотиков, а если что-то такое было — я это запикал и убрал из
                текста.
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 text-[13px] leading-snug text-omf-graphite">
              <input
                type="checkbox"
                checked={termsAccepted}
                disabled={isSubmitting}
                aria-invalid={termsHint && !termsAccepted}
                onChange={(e) => {
                  triggerHaptic("light");
                  setTermsAccepted(e.target.checked);
                  if (e.target.checked && contentAccepted) setTermsHint(false);
                }}
                className="mt-0.5 h-5 w-5 shrink-0 rounded-[6px] accent-[var(--omf-ultra)]"
              />
              <span>
                Понимаю, что выпуск платный, цену согласует студия, и оплата не возвращается, даже если площадки не
                пропустят релиз из-за содержания.
              </span>
            </label>
            {referral?.hasPendingDiscount ? (
              <p className="mt-2 pl-8 text-[13px] text-omf-yellow">
                Скидка {formatRub(REFEREE_DISCOUNT_RUB)} по приглашению друга, студия учтёт её при оплате.
              </p>
            ) : null}
            {termsHint && (!termsAccepted || !contentAccepted) ? (
              <p role="alert" className="mt-2 pl-8 text-[13px] text-omf-red">
                {!termsAccepted && !contentAccepted ? "Отметь обе галочки, чтобы отправить релиз." : "Отметь галочку, чтобы отправить релиз."}
              </p>
            ) : null}
          </div>
        ) : null}

        {showProgressPanel ? <UploadProgress label={stageLabel} progress={submitProgress} /> : null}

        {submitError && (
          <p className="break-words text-center text-[14px] leading-relaxed text-omf-red">
            {submitError}{" "}
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                router.push("/create/tracks");
              }}
              className="inline font-bold underline underline-offset-4"
            >
              Вернуться к трекам
            </button>
          </p>
        )}

        {!progressActive ? (
          <WizardActionBar>
            <button
              type="button"
              disabled={submitBlocked}
              onClick={() => void handleSubmit()}
              className={cn(
                "create-flow-submit-target omf-btn-primary h-[52px] w-full text-[16px] font-medium",
                termsAccepted && contentAccepted && !submitBlocked && !tracksUploadInProgress && "omf-btn-shine"
              )}
            >
              <BusyLabel busy={tracksUploadInProgress} busyText="Загружаем WAV…">
                Отправить на проверку
              </BusyLabel>
            </button>
          </WizardActionBar>
        ) : null}
      </div>
    </CreateShell>
  );
}
