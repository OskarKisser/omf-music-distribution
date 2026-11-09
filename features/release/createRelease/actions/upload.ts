import { formatErrorMessage, getPostgrestErrorPayload, USER_REQUEST_TIMEOUT_MESSAGE } from "@/lib/errors";
import { withRequestTimeout } from "@/lib/withRequestTimeout";
import { getUploadErrorDetails } from "@/lib/logger";
import { requestScreenWakeLock, releaseWakeLock } from "@/lib/wake-lock";
import { hapticMap } from "@/lib/haptic-map";
import { addReleaseTrack, uploadReleaseTrackAudio } from "@/repositories/releases.repo";
import { tracksSchema } from "../schemas";
import { useCreateReleaseDraftStore } from "../store";
import { toast } from "sonner";
import { ensureDraftRelease, postDraftUploadState, saveDraftAction } from "./draft";
import { persistCombinedReleaseLyricsFromStore } from "./resume";
import { SUPABASE_DB_OP_TIMEOUT_MS, initUserContextInStore, parseStoreUserId, syncWebUserIntoStore, verifyStoredReleaseExistsOrClearReleaseId } from "./session";

export async function uploadTrackWavAtIndex(options: {
  index: number;
  file: File;
  onProgress?: (percent: number) => void;
}): Promise<boolean> {
  initUserContextInStore();
  await syncWebUserIntoStore();
  let store = useCreateReleaseDraftStore.getState();
  if (!store.userId) {
    store.setSubmitError(
      "Не удалось определить пользователя. Откройте приложение из Telegram или войдите на сайте."
    );
    return false;
  }
  const userId = parseStoreUserId(store.userId);
  if (userId == null) {
    store.setSubmitError("Нет данных пользователя для загрузки треков.");
    return false;
  }
  const parsedTracks = tracksSchema.safeParse({ tracks: store.tracks });
  if (!parsedTracks.success) {
    store.setSubmitError(parsedTracks.error.issues[0]?.message ?? "Проверьте данные треков.");
    return false;
  }
  const track = parsedTracks.data.tracks[options.index];
  if (!track) {
    store.setSubmitError("Нет данных трека.");
    return false;
  }
  await verifyStoredReleaseExistsOrClearReleaseId();
  store = useCreateReleaseDraftStore.getState();
  if (!store.releaseId) {
    const saved = await saveDraftAction();
    if (!saved.ok) {
      useCreateReleaseDraftStore.getState().setSubmitError(saved.message);
      return false;
    }
  }
  store = useCreateReleaseDraftStore.getState();
  const releaseId = store.releaseId;
  if (!releaseId) {
    store.setSubmitError("Нет идентификатора релиза.");
    return false;
  }

  useCreateReleaseDraftStore.getState().setTracksUploadInProgress(true);
  const wake = await requestScreenWakeLock();
  try {
    store.setSubmitError(null);
    options.onProgress?.(0);

    let audioUrl: string;
    try {
      audioUrl = await uploadReleaseTrackAudio({
        userId,
        releaseId,
        trackIndex: options.index,
        file: options.file,
        options: {
          markReleaseFailedOnError: { releaseId },
          onProgress: options.onProgress
        }
      });
    } catch (e: unknown) {
      console.error("[uploadTrackWavAtIndex] Storage (WAV) upload failed", { error: e });
      const up = getUploadErrorDetails(e);
      const sc =
        e && typeof e === "object" && "statusCode" in e
          ? Number((e as { statusCode?: unknown }).statusCode)
          : NaN;
      const statusLabel = Number.isFinite(sc) ? String(sc) : "0 (сеть/обрыв)";
      const msg = formatErrorMessage(
        e,
        "Не удалось загрузить WAV в хранилище. Проверьте политику bucket, размер и формат файла."
      );
      useCreateReleaseDraftStore.getState().setSubmitError(msg);
      toast.error(`Загрузка WAV: ${msg}`, {
        description: `HTTP ${statusLabel}${up.supabaseHint ? ` · ${up.supabaseHint}` : ""}`
      });
      return false;
    }

    try {
      await withRequestTimeout(
        addReleaseTrack({
          releaseId,
          index: options.index,
          title: track.title,
          explicit: Boolean(track.explicit),
          audioUrl,
          lyrics: track.lyrics,
          originalFilename: options.file.name
        }),
        SUPABASE_DB_OP_TIMEOUT_MS,
        USER_REQUEST_TIMEOUT_MESSAGE
      );
      await persistCombinedReleaseLyricsFromStore(releaseId);
    } catch (e: unknown) {
      console.error("[uploadTrackWavAtIndex] DB tracks upsert failed", {
        postgrest: getPostgrestErrorPayload(e),
        error: e
      });
      useCreateReleaseDraftStore.getState().setSubmitError(
        formatErrorMessage(
          e,
          "Файл в хранилище загружен, но не удалось сохранить строку в таблице tracks. Проверьте схему БД и RLS."
        )
      );
      return false;
    }

    useCreateReleaseDraftStore.getState().setTrackAudioUrlAt(options.index, audioUrl);
    try {
      hapticMap.notificationSuccess();
    } catch {
      /* ignore */
    }
    return true;
  } finally {
    releaseWakeLock(wake);
    useCreateReleaseDraftStore.getState().setTracksUploadInProgress(false);
  }
}

/**
 * Загрузка WAV на шаге «Треки» с прогрессом; URL в сторе → `selectTracksWavFullySynced`.
 */
export async function uploadTracksForDraftStep(options: {
  onTrackProgress: (index: number, percent: number) => void;
}): Promise<boolean> {
  initUserContextInStore();
  await syncWebUserIntoStore();
  let store = useCreateReleaseDraftStore.getState();
  if (!store.userId) {
    store.setSubmitError(
      "Не удалось определить пользователя. Откройте приложение из Telegram или войдите на сайте."
    );
    return false;
  }
  await verifyStoredReleaseExistsOrClearReleaseId();
  store = useCreateReleaseDraftStore.getState();
  if (!store.releaseId) {
    const draft = await ensureDraftRelease();
    if (!draft) {
      store.setSubmitError("Нет данных релиза для загрузки треков.");
      return false;
    }
    store = useCreateReleaseDraftStore.getState();
  }
  const parsedTracks = tracksSchema.safeParse({ tracks: store.tracks });
  if (!parsedTracks.success) {
    store.setSubmitError(parsedTracks.error.issues[0]?.message ?? "Проверьте данные треков.");
    return false;
  }
  const { tracks } = parsedTracks.data;
  const { trackFiles } = store;
  if (trackFiles.length !== tracks.length || tracks.some((_t, i) => !trackFiles[i])) {
    store.setSubmitError("Загрузите WAV для каждого трека.");
    return false;
  }
  const releaseIdMaybe = store.releaseId;
  if (!releaseIdMaybe) {
    store.setSubmitError("Нет идентификатора релиза.");
    return false;
  }
  const releaseId = releaseIdMaybe;
  const userId = parseStoreUserId(store.userId);
  if (userId == null) {
    store.setSubmitError("Нет данных пользователя для загрузки треков.");
    return false;
  }
  useCreateReleaseDraftStore.getState().setTracksUploadInProgress(true);
  const wake = await requestScreenWakeLock();
  try {
    store.setSubmitError(null);
    await postDraftUploadState(releaseId, "start");

    try {
      for (let index = 0; index < tracks.length; index += 1) {
        const file = trackFiles[index]!;
        const track = tracks[index];
        let audioUrl = (
          useCreateReleaseDraftStore.getState().trackAudioUrlsFromDb[index] ?? ""
        ).trim();

        if (!audioUrl) {
          options.onTrackProgress(index, 0);
          try {
            audioUrl = await uploadReleaseTrackAudio({
              userId,
              releaseId,
              trackIndex: index,
              file,
              options: {
                markReleaseFailedOnError: { releaseId },
                onProgress: (pct) => options.onTrackProgress(index, pct)
              }
            });
          } catch (e: unknown) {
            void postDraftUploadState(releaseId, "failed");
            console.error("[uploadTracksForDraftStep] Storage (WAV) upload failed", {
              phase: "storage",
              trackIndex: index,
              releaseId,
              hint: "Network → POST …/storage/v1/object/releases/…",
              error: e
            });
            const up = getUploadErrorDetails(e);
            const sc =
              e && typeof e === "object" && "statusCode" in e
                ? Number((e as { statusCode?: unknown }).statusCode)
                : NaN;
            const statusLabel = Number.isFinite(sc) ? String(sc) : "0 (сеть/обрыв)";
            const msg = formatErrorMessage(
              e,
              "Не удалось загрузить WAV в хранилище. Проверьте политику bucket «releases», размер и формат файла."
            );
            useCreateReleaseDraftStore.getState().setSubmitError(msg);
            toast.error(`Трек ${index + 1}: ${msg}`, {
              description: `HTTP ${statusLabel}${up.supabaseHint ? ` · ${up.supabaseHint}` : ""}`
            });
            return false;
          }
          useCreateReleaseDraftStore.getState().setTrackAudioUrlAt(index, audioUrl);
        } else {
          options.onTrackProgress(index, 100);
        }

        try {
          await withRequestTimeout(
            addReleaseTrack({
              releaseId,
              index,
              title: track.title,
              explicit: Boolean(track.explicit),
              audioUrl,
              lyrics: track.lyrics,
              originalFilename: file.name
            }),
            SUPABASE_DB_OP_TIMEOUT_MS,
            USER_REQUEST_TIMEOUT_MESSAGE
          );
        } catch (e: unknown) {
          void postDraftUploadState(releaseId, "failed");
          console.error("[uploadTracksForDraftStep] DB tracks upsert failed", {
            phase: "database",
            trackIndex: index,
            releaseId,
            hint: "Network → POST …/rest/v1/tracks — колонка file_path, RLS, UNIQUE(release_id,index)",
            postgrest: getPostgrestErrorPayload(e),
            error: e
          });
          useCreateReleaseDraftStore.getState().setSubmitError(
            formatErrorMessage(
              e,
              "Файл в хранилище загружен, но не удалось сохранить строку в таблице tracks. Проверьте схему БД и RLS."
            )
          );
          return false;
        }
      }

      await persistCombinedReleaseLyricsFromStore(releaseId);
    } catch (e: unknown) {
      void postDraftUploadState(releaseId, "failed");
      console.error("[uploadTracksForDraftStep] unexpected", { error: e });
      useCreateReleaseDraftStore
        .getState()
        .setSubmitError(formatErrorMessage(e, "Ошибка загрузки WAV."));
      return false;
    }

    await postDraftUploadState(releaseId, "complete");
    return true;
  } finally {
    releaseWakeLock(wake);
    useCreateReleaseDraftStore.getState().setTracksUploadInProgress(false);
  }
}
