import { formatErrorMessage, getPostgrestErrorPayload, USER_REQUEST_TIMEOUT_MESSAGE } from "@/lib/errors";
import { withRequestTimeout } from "@/lib/withRequestTimeout";
import { getUploadErrorDetails, logClientError } from "@/lib/logger";
import { hapticMap } from "@/lib/haptic-map";
import { addReleaseTrack, cleanupReleaseTracks, deleteReleaseFiles, getReleaseById, getReleaseDisplayTitle, markReleaseFailed, updateRelease, uploadReleaseTrackAudio } from "@/repositories/releases.repo";
import type { ReleaseRecord, UpdateReleasePatch } from "@/repositories/releases.repo";
import { metadataSchema, tracksSchema } from "../schemas";
import { selectTracksWavFullySynced, useCreateReleaseDraftStore } from "../store";
import { celebrateReleaseSubmission } from "@/lib/confetti-release-success";
import { refreshReleasesListAfterSubmit } from "@/lib/releases-swr-cache";
import { trackFunnel } from "@/lib/funnel-analytics";
import { buildReleaseRowPatchFromMetadata } from "./draft";
import { persistCombinedReleaseLyricsFromStore, syncTrackRowsAndReleaseLyrics } from "./resume";
import { SUPABASE_DB_OP_TIMEOUT_MS, initUserContextInStore, parseStoreUserId, requestReleaseSubmitPrecheck, submitReleaseViaServiceApi, syncWebUserIntoStore } from "./session";

/** Защита от двойного сабмита (двойной тап в Telegram). */
let submitTracksInFlight = false;

export async function submitTracksAndFinalize(args: {
  files: File[];
  termsAccepted: boolean;
}): Promise<boolean> {
  initUserContextInStore();
  await syncWebUserIntoStore();
  const store = useCreateReleaseDraftStore.getState();

  if (submitTracksInFlight) {
    store.setSubmitError("Отправка уже выполняется. Дождитесь завершения.");
    return false;
  }

  store.setSubmitStage("idle");
  store.setSubmitProgress(0);
  if (!store.userId || !store.releaseId) {
    store.setSubmitError("Нет данных релиза для отправки.");
    return false;
  }

  if (!store.clientRequestId) {
    store.setSubmitError("Нет client_request_id. Сохраните паспорт релиза (шаг «Паспорт») и повторите.");
    return false;
  }

  const parsedTracks = tracksSchema.safeParse({ tracks: store.tracks });
  if (!parsedTracks.success) {
    const msg =
      parsedTracks.error.issues[0]?.message ?? "Проверьте данные треков.";
    store.setSubmitError(msg);
    return false;
  }

  const skipWavUpload = selectTracksWavFullySynced(useCreateReleaseDraftStore.getState());

  if (!skipWavUpload) {
    if (args.files.length !== parsedTracks.data.tracks.length) {
      store.setSubmitError("Загрузите WAV для каждого трека.");
      return false;
    }
  }

  submitTracksInFlight = true;
  trackFunnel("submit_attempt", { releaseId: store.releaseId, step: "review" });
  store.setSubmitStatus("submitting");
  store.setSubmitStage("preparing");
  store.setSubmitProgress(5);
  store.setSubmitError(null);

  const totalTracks = parsedTracks.data.tracks.length;
  const releaseId = store.releaseId;
  const clientRequestId = store.clientRequestId;
  const submitUserId = parseStoreUserId(store.userId)!;

  const setTrackUploadProgress = (trackIndex: number, filePercent: number) => {
    const segment = (trackIndex + filePercent / 100) / Math.max(totalTracks, 1);
    store.setSubmitProgress(15 + segment * 70);
  };

  let uploadPhase:
    | "preparing"
    | "db_artwork_url"
    | "storage_track_wav"
    | "db_release_track"
    | "finalizing_submit" = "preparing";
  let uploadTrackIndex: number | null = null;

  try {
    let existing: ReleaseRecord;
    try {
      uploadPhase = "preparing";
      existing = await getReleaseById(releaseId);
      if (existing.status === "failed") {
        await updateRelease(releaseId, { status: "draft", error_message: null });
      }

      if (store.artworkUrl) {
        uploadPhase = "db_artwork_url";
        await updateRelease(releaseId, { artwork_url: store.artworkUrl });
        store.setSubmitProgress(15);
      }

      if (skipWavUpload) {
        useCreateReleaseDraftStore.getState().setSubmitStage("uploading_tracks");
        useCreateReleaseDraftStore.getState().setSubmitProgress(85);
        const stNow = useCreateReleaseDraftStore.getState();
        await syncTrackRowsAndReleaseLyrics({
          releaseId,
          tracks: parsedTracks.data.tracks,
          audioUrls: stNow.trackAudioUrlsFromDb
        });
      } else {
        for (let index = 0; index < parsedTracks.data.tracks.length; index += 1) {
          uploadTrackIndex = index;
          store.setSubmitStage("uploading_tracks");
          const track = parsedTracks.data.tracks[index];
          const file = args.files[index];
          uploadPhase = "storage_track_wav";
          const audioUrl = await uploadReleaseTrackAudio({
            userId: submitUserId,
            releaseId,
            trackIndex: index,
            file,
            options: {
              markReleaseFailedOnError: { releaseId },
              onProgress: (pct) => setTrackUploadProgress(index, pct)
            }
          });
          uploadPhase = "db_release_track";
          await withRequestTimeout(
            addReleaseTrack({
              releaseId,
              index,
              title: track.title,
              explicit: Boolean(track.explicit),
              audioUrl,
              lyrics: track.lyrics
            }),
            SUPABASE_DB_OP_TIMEOUT_MS,
            USER_REQUEST_TIMEOUT_MESSAGE
          );
          setTrackUploadProgress(index + 1, 0);
        }
        await persistCombinedReleaseLyricsFromStore(releaseId);
      }
      uploadTrackIndex = null;
    } catch (e: unknown) {
      const up = getUploadErrorDetails(e);
      logClientError({
        error: e,
        screenName: "CreateReview_submitUpload",
        route: "/create/review",
        extra: {
          flow: "submitTracksAndFinalize",
          uploadPhase,
          trackIndex: uploadTrackIndex,
          httpStatus: up.httpStatus,
          supabaseStorageHint: up.supabaseHint
        }
      });
      if (uploadPhase === "db_release_track") {
        console.error("[submitTracksAndFinalize] DB tracks upsert failed", {
          phase: "database",
          trackIndex: uploadTrackIndex,
          releaseId,
          hint: "Network → POST …/rest/v1/tracks — колонка file_path, RLS, UNIQUE(release_id,index)",
          postgrest: getPostgrestErrorPayload(e),
          error: e
        });
      } else if (uploadPhase === "storage_track_wav") {
        console.error("[submitTracksAndFinalize] Storage (WAV) upload failed", {
          phase: "storage",
          trackIndex: uploadTrackIndex,
          releaseId,
          hint: "Network → POST …/storage/v1/object/releases/…",
          error: e
        });
      }
      let cleanupFailed = false;
      let existingMessage: string | null = null;
      try {
        const current = await getReleaseById(releaseId).catch(() => null);
        existingMessage = current?.error_message?.trim() ?? null;

        if (!skipWavUpload) {
          await cleanupReleaseTracks(releaseId);
          await deleteReleaseFiles({
            userId: parseStoreUserId(store.userId)!,
            releaseId,
            trackCount: parsedTracks.data.tracks.length
          });
        }

        if (!current || current.status !== "failed") {
          await markReleaseFailed(
            releaseId,
            skipWavUpload ? "Отправка прервана." : "Отправка прервана, временные файлы очищены."
          );
        }
      } catch {
        cleanupFailed = true;
      }

      trackFunnel("submit_error", { releaseId: useCreateReleaseDraftStore.getState().releaseId, step: "upload" });
      useCreateReleaseDraftStore.getState().setSubmitStatus("error");
      useCreateReleaseDraftStore.getState().setSubmitStage("error");
      const detail = e instanceof Error ? e.message : JSON.stringify(e);

      const defaultMessage =
        uploadPhase === "storage_track_wav"
          ? formatErrorMessage(
              e,
              "Не удалось загрузить WAV в хранилище. Проверьте политику bucket «releases», размер и формат файла."
            )
          : uploadPhase === "db_release_track"
            ? formatErrorMessage(
                e,
                "Файл в хранилище загружен, но не удалось сохранить строку в таблице tracks. Проверьте схему БД и RLS."
              )
            : `Ошибка отправки: ${detail}`;

      const primary =
        existingMessage && existingMessage.length > 0
          ? existingMessage
          : defaultMessage;

      useCreateReleaseDraftStore.getState().setSubmitError(
        cleanupFailed
          ? `${primary}. Автоочистка завершилась с ошибкой — обратитесь к администратору.`
          : `${primary}. Временные файлы очищены, можно повторить отправку.`
      );
      return false;
    }

    try {
      uploadPhase = "finalizing_submit";
      const storeAfterUpload = useCreateReleaseDraftStore.getState();
      storeAfterUpload.setSubmitStage("finalizing");
      storeAfterUpload.setSubmitProgress(92);

      const parsedMetaForSubmit = metadataSchema.safeParse(storeAfterUpload.metadata);
      if (parsedMetaForSubmit.success) {
        await withRequestTimeout(
          updateRelease(
            releaseId,
            buildReleaseRowPatchFromMetadata(
              parsedMetaForSubmit.data,
              storeAfterUpload.artworkUrl,
              storeAfterUpload.tracks,
              existing.collaborators
            ) as UpdateReleasePatch
          ),
          SUPABASE_DB_OP_TIMEOUT_MS,
          USER_REQUEST_TIMEOUT_MESSAGE
        );
      }

      const precheck = await requestReleaseSubmitPrecheck({
        releaseId,
        clientRequestId,
        declaredTrackCount: totalTracks
      });
      if (!precheck.ok) {
        trackFunnel("submit_error", { releaseId: storeAfterUpload.releaseId, step: "precheck" });
        storeAfterUpload.setSubmitStatus("error");
        storeAfterUpload.setSubmitStage("error");
        storeAfterUpload.setSubmitError(precheck.message);
        console.error("[submitTracksAndFinalize] submit-precheck rejected", {
          message: precheck.message,
          releaseId,
          clientRequestId
        });
        try {
          hapticMap.notificationWarning();
        } catch {
          /* ignore */
        }
        logClientError({
          error: new Error(precheck.message),
          screenName: "CreateReview_submitPrecheck",
          route: "/create/review",
          extra: { flow: "submitTracksAndFinalize", phase: "submit_precheck" }
        });
        return false;
      }

      const verified = await submitReleaseViaServiceApi({
        releaseId,
        clientRequestId,
        termsAccepted: args.termsAccepted
      });

      if (process.env.NODE_ENV === "development") {
        if (verified.status !== "processing" && verified.status !== "ready") {
          console.warn(
            "[submitTracksAndFinalize] unexpected status after ensure:",
            verified.status
          );
        }
      }

      if (verified.status === "pending" || verified.status === "processing") {
        celebrateReleaseSubmission();
      }

      // Cache refresh is best-effort and must not block success navigation.
      void refreshReleasesListAfterSubmit(verified).catch(() => {});

      const storeOk = useCreateReleaseDraftStore.getState();
      trackFunnel("submit_success", { releaseId: storeOk.releaseId, step: "review" });
      storeOk.setSubmitStatus("success");
      storeOk.setSubmitStage("done");
      storeOk.setSubmitProgress(100);
      const title = getReleaseDisplayTitle(verified).trim() || "Релиз";
      storeOk.setSuccessSummary({
        artistName: verified.artist_name?.trim() || "Артист",
        trackName: title,
        releaseName: title,
        coverUrl: verified.artwork_url ?? null
      });
      // Очистить мастер только после подтверждённого статуса в БД; successSummary для /create/success.
      // Состояние submit (прогресс 100%) сохраняем для exit-анимации на Review — см. clearCreateFormKeepSummaryPreserveSubmit.
      storeOk.clearCreateFormKeepSummaryPreserveSubmit();
      try {
        hapticMap.notificationSuccess();
      } catch {}
      return true;
    } catch (e: unknown) {
      logClientError({
        error: e,
        screenName: "CreateReview_submitFinalize",
        route: "/create/review",
        extra: { flow: "submitTracksAndFinalize", uploadPhase: "finalizing_submit" }
      });
      console.error("[submitTracksAndFinalize] finalize error (full)", e);
      const storeFail = useCreateReleaseDraftStore.getState();
      trackFunnel("submit_error", { releaseId: storeFail.releaseId, step: "finalize" });
      storeFail.setSubmitStatus("error");
      storeFail.setSubmitStage("error");
      const detail = e instanceof Error ? e.message : JSON.stringify(e);
      storeFail.setSubmitError(
        detail.includes("Не удалось отправить релиз на модерацию")
          ? detail
          : `Ошибка отправки: ${detail}`
      );
      return false;
    }
  } finally {
    submitTracksInFlight = false;
  }
}
