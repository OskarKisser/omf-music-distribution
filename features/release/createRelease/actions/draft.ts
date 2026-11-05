import { formatErrorMessage } from "@/lib/errors";
import { getUploadErrorDetails, logClientError } from "@/lib/logger";
import { getTelegramUser, initTelegramWebApp } from "@/lib/telegram";
import { hapticMap } from "@/lib/haptic-map";
import { createDraftRelease, getLatestDraftReleaseId, getReleaseById, updateRelease, uploadReleaseArtwork } from "@/repositories/releases.repo";
import type { ReleaseRecord, UpdateReleasePatch } from "@/repositories/releases.repo";
import type { CreateMetadata, CreateTrack } from "../types";
import { metadataSchema } from "../schemas";
import { useCreateReleaseDraftStore } from "../store";
import { createSupabaseBrowser } from "@/lib/supabase";
import { RELEASE_TYPE_VALUES } from "@/lib/db-enums";
import { artistLinksToJson } from "@/lib/artist-links";
import { buildCollaboratorsPayloadForDb, unionFeaturingNamesFromTracks } from "@/lib/collaborators";
import { parseTimecodeToSeconds } from "@/lib/release-rights";
import { createClientRequestId, getCreateReleaseApiAuthHeaders, initUserContextInStore, isPostgrestNoSuchRowError, parseStoreUserId, syncWebUserIntoStore, verifyStoredReleaseExistsOrClearReleaseId } from "./session";

export async function ensureDraftRelease(): Promise<ReleaseRecord | null> {
  initUserContextInStore();
  await syncWebUserIntoStore();

  let store = useCreateReleaseDraftStore.getState();
  const parsed = metadataSchema.safeParse(store.metadata);
  if (!parsed.success) {
    const msg =
      parsed.error.issues[0]?.message ?? "Заполните паспорт релиза корректно.";
    store.setSubmitError(msg);
    return null;
  }

  if (store.releaseId) {
    try {
      const row = await getReleaseById(store.releaseId);
      if (row.status === "processing" || row.status === "ready") {
        store.setSubmitError("Этот релиз уже отправлен на проверку.");
        return null;
      }
    } catch (e: unknown) {
      if (isPostgrestNoSuchRowError(e)) {
        useCreateReleaseDraftStore.getState().setReleaseId(null);
      }
    }
  }

  const mainArtistName = parsed.data.primaryArtist ?? "";
  store = useCreateReleaseDraftStore.getState();
  const tgUser = getTelegramUser();
  const storeUid = parseStoreUserId(store.userId);

  const {
    data: { session }
  } = await createSupabaseBrowser().auth.getSession();

  const hasIdentity =
    Boolean(tgUser?.id) || (storeUid != null && storeUid > 0) || Boolean(session?.user);
  if (!hasIdentity) {
    store.setSubmitError(
      "Не удалось определить аккаунт. Откройте приложение из Telegram или войдите на сайте."
    );
    return null;
  }

  const clientRequestId = createClientRequestId(store.clientRequestId);

  try {
    store.setSubmitError(null);
    // Владельца (user_id / telegram_id / user_uuid) сервер берёт из initData или cookie-сессии.
    const draft = await createDraftRelease({
      client_request_id: clientRequestId,
      artist_name: mainArtistName,
      track_name: parsed.data.releaseTitle,
      release_type: parsed.data.releaseType,
      genre: parsed.data.genre,
      release_date: parsed.data.releaseDate,
      explicit: Boolean(parsed.data.explicit)
    });

    store.setReleaseId(draft.id);
    store.setClientRequestId(clientRequestId);
    try {
      hapticMap.notificationSuccess();
    } catch {}
    return draft;
  } catch (e: unknown) {
    store.setSubmitError(formatErrorMessage(e, "Не удалось создать черновик."));
    logClientError({
      error: e,
      screenName: "CreateRelease_ensureDraft",
      route: "/create/assets",
      extra: { step: "ensureDraftRelease" }
    });
    return null;
  }
}

export async function uploadArtworkForDraft(file: File): Promise<string | null> {
  let store = useCreateReleaseDraftStore.getState();
  initUserContextInStore();
  await syncWebUserIntoStore();
  store = useCreateReleaseDraftStore.getState();
  if (!store.userId) {
    store.setSubmitError(
      "Не удалось определить пользователя. Откройте приложение из Telegram или войдите на сайте."
    );
    return null;
  }
  await verifyStoredReleaseExistsOrClearReleaseId();
  store = useCreateReleaseDraftStore.getState();
  if (!store.releaseId) {
    const draft = await ensureDraftRelease();
    if (!draft) {
      return null;
    }
    store = useCreateReleaseDraftStore.getState();
  }
  try {
    store.setSubmitError(null);
    const artworkUrl = await uploadReleaseArtwork({
      userId: parseStoreUserId(store.userId)!,
      releaseId: store.releaseId!,
      file,
      options: {
        markReleaseFailedOnError: { releaseId: store.releaseId! }
      }
    });
    store.setArtworkUrl(artworkUrl);
    try {
      hapticMap.notificationSuccess();
    } catch {}
    return artworkUrl;
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : JSON.stringify(e);
    store.setSubmitError(`Ошибка загрузки обложки: ${detail}`);
    const up = getUploadErrorDetails(e);
    logClientError({
      error: e,
      screenName: "CreateRelease_uploadArtwork",
      route: "/create/assets",
      extra: { step: "uploadArtworkForDraft", ...up }
    });
    return null;
  }
}

/** Поля паспорта → колонки `releases` (как в `saveDraftAction`, без строгой Zod-проверки). */
export function buildReleaseRowPatchFromMetadata(
  m: CreateMetadata,
  artworkUrl: string | null,
  tracks: CreateTrack[],
  existingCollaboratorsFromDb?: unknown
): Record<string, unknown> {
  const mainArtist = m.primaryArtist ?? "";
  const featuringArtistNames = unionFeaturingNamesFromTracks(tracks);
  const artistLinks = artistLinksToJson(useCreateReleaseDraftStore.getState().releaseArtistLinks);
  return {
    artist_name: mainArtist,
    title: m.releaseTitle,
    release_type: m.releaseType,
    genre: m.genre,
    release_date: m.releaseDate,
    explicit: m.explicit,
    author_full_name: m.authorFullName?.trim() || null,
    music_author: m.musicAuthor?.trim() || null,
    license_type: m.licenseType || null,
    tiktok_start_sec: parseTimecodeToSeconds(m.tiktokStart),
    artist_links: artistLinks,
    has_existing_profiles: Object.keys(artistLinks).length > 0,
    collaborators: buildCollaboratorsPayloadForDb(
      mainArtist,
      featuringArtistNames,
      existingCollaboratorsFromDb
    ),
    ...(artworkUrl ? { artwork_url: artworkUrl } : {})
  };
}

/**
 * Фоновое сохранение паспорта в Supabase для уже существующего черновика (без валидации Zod).
 * Нужно для Mini App: при свайпе закрытия локальный стор может не успеть дописаться, но строка в БД уже есть.
 */
export async function syncPassportFormToReleaseDraft(
  metadata: CreateMetadata,
  options?: { keepalive?: boolean }
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    initUserContextInStore();
    await syncWebUserIntoStore();
  } catch {
    return false;
  }
  const store = useCreateReleaseDraftStore.getState();
  const rid = store.releaseId;
  if (!rid) return false;
  const patch = buildReleaseRowPatchFromMetadata(
    metadata,
    store.artworkUrl,
    store.tracks
  );
  // Форма может быть заполнена частично: тип релиза сервер принимает только из списка.
  if (!(RELEASE_TYPE_VALUES as readonly unknown[]).includes(patch.release_type)) {
    delete patch.release_type;
  }
  try {
    await updateRelease(rid, patch as UpdateReleasePatch, { keepalive: options?.keepalive });
    return true;
  } catch {
    return false;
  }
}

/**
 * Сохраняет текущие метаданные (и обложку, если есть) в строку `releases` в БД.
 * При отсутствии `releaseId` создаёт черновик через `ensureDraftRelease`.
 */
export async function saveDraftAction(
  metadataOverride?: CreateMetadata
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    initUserContextInStore();
    await syncWebUserIntoStore();
  } catch (e: unknown) {
    return {
      ok: false,
      message: formatErrorMessage(e, "Не удалось проверить авторизацию.")
    };
  }
  const store = useCreateReleaseDraftStore.getState();
  const parsed = metadataSchema.safeParse(metadataOverride ?? store.metadata);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Заполните паспорт релиза корректно."
    };
  }
  if (!store.userId) {
    return {
      ok: false,
      message: "Войдите на сайте или откройте приложение из Telegram."
    };
  }
  try {
    // Keep store in sync with the exact payload validated by RHF submit.
    store.setMetadata(parsed.data);
    store.setSubmitError(null);
    await verifyStoredReleaseExistsOrClearReleaseId();
    if (!useCreateReleaseDraftStore.getState().releaseId) {
      const draft = await ensureDraftRelease();
      if (!draft) {
        return {
          ok: false,
          message: useCreateReleaseDraftStore.getState().submitError ?? "Не удалось создать черновик."
        };
      }
    }
    const rid = useCreateReleaseDraftStore.getState().releaseId;
    if (!rid) {
      return { ok: false, message: "Нет идентификатора релиза." };
    }
    const m = parsed.data;
    const latest = useCreateReleaseDraftStore.getState();
    const currentRow = await getReleaseById(rid);
    const finalData = buildReleaseRowPatchFromMetadata(
      m,
      latest.artworkUrl,
      latest.tracks,
      currentRow.collaborators
    );

    await updateRelease(rid, finalData as UpdateReleasePatch);
    return { ok: true };
  } catch (e: unknown) {
    console.error("[saveDraftAction] failed:", e);
    return {
      ok: false,
      message: formatErrorMessage(e, "Не удалось сохранить черновик.")
    };
  }
}

/** Последний черновик текущего пользователя (для предложения «Продолжить»). */
export async function fetchLatestDraftReleaseIdForUser(): Promise<string | null> {
  try {
    return await getLatestDraftReleaseId();
  } catch {
    return null;
  }
}

export async function postDraftUploadState(
  releaseId: string,
  phase: "start" | "complete" | "failed"
): Promise<boolean> {
  const bodyJson = JSON.stringify({ releaseId, phase });
  const doFetch = (authHeaders: Record<string, string>) =>
    fetch("/api/releases/draft-upload-state", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders
      },
      body: bodyJson
    });

  try {
    let authHeaders =
      typeof window !== "undefined" ? getCreateReleaseApiAuthHeaders() : {};
    let res = await doFetch(authHeaders);

    if (res.status === 401 && typeof window !== "undefined") {
      initTelegramWebApp();
      authHeaders = getCreateReleaseApiAuthHeaders();
      res = await doFetch(authHeaders);
    }

    let body: { ok?: boolean; error?: string; degraded?: boolean } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* ignore */
    }
    if ((!res.ok || !body.ok) && process.env.NODE_ENV === "development") {
      console.warn("[postDraftUploadState] server response:", {
        phase,
        releaseId,
        status: res.status,
        body
      });
    }
    if (!res.ok && res.status === 401) {
      console.error("[postDraftUploadState] Unauthorized", {
        phase,
        releaseId,
        body,
        hadInitDataHeader: Boolean(authHeaders["X-Telegram-Init-Data"]),
        hadDevUserHeader: Boolean(authHeaders["X-Dev-Telegram-User-Id"])
      });
    }
    return res.ok && body.ok === true;
  } catch (e) {
    console.warn("[postDraftUploadState] fetch failed:", phase, releaseId, e);
    return false;
  }
}

/**
 * Сразу после выбора WAV: Storage + строка в `tracks` (один трек).
 * При отсутствии `releaseId` вызывает `saveDraftAction()` (нужен валидный паспорт).
 */
