import { formatErrorMessage, USER_REQUEST_TIMEOUT_MESSAGE } from "@/lib/errors";
import { withRequestTimeout } from "@/lib/withRequestTimeout";
import { getAdminTelegramIdForUi, telegramIdsEqual } from "@/lib/admin";
import { addReleaseTrack, getReleaseById, getReleaseDisplayTitle, getReleaseWithTracks, updateRelease } from "@/repositories/releases.repo";
import type { ReleaseRecord, ReleaseTrackRow } from "@/repositories/releases.repo";
import type { CreateMetadata, CreateTrack } from "../types";
import { FIXED_RELEASE_LABEL, isAssetsComplete, isMetadataComplete, isTracksComplete, metadataHydrateSchema, tracksSchema } from "../schemas";
import { useCreateReleaseDraftStore } from "../store";
import { parseArtistLinksFromJson } from "@/lib/artist-links";
import { featuringNamesFromCollaboratorsJson, parseCollaboratorsFromDb } from "@/lib/collaborators";
import { parsePerformanceLanguage } from "@/lib/performance-language";
import { trackFunnel } from "@/lib/funnel-analytics";
import { formatSecondsAsTimecode, normalizeGenre } from "@/lib/release-rights";
import { SUPABASE_DB_OP_TIMEOUT_MS, getCreateReleaseApiAuthHeaders, initUserContextInStore } from "./session";

export function createMetadataFromReleaseRecord(existing: ReleaseRecord): CreateMetadata {
  const rows = parseCollaboratorsFromDb(existing.collaborators);
  const primaryName =
    rows[0]?.name?.trim() || String(existing.artist_name ?? "").trim();
  return {
    primaryArtist: primaryName,
    releaseTitle: getReleaseDisplayTitle(existing),
    releaseType: existing.release_type,
    genre: normalizeGenre(existing.genre),
    subgenre: "",
    language: parsePerformanceLanguage(existing.performance_language),
    label: FIXED_RELEASE_LABEL,
    releaseDate: existing.release_date,
    explicit: Boolean(existing.explicit),
    authorFullName: existing.author_full_name?.trim() ?? "",
    musicAuthor: existing.music_author?.trim() ?? "",
    licenseType: existing.license_type?.trim() ?? "",
    tiktokStart: formatSecondsAsTimecode(existing.tiktok_start_sec)
  };
}

function buildCombinedReleaseLyrics(tracks: CreateTrack[]): string | null {
  const parts: string[] = [];
  for (const t of tracks) {
    const L = t.lyrics == null ? "" : String(t.lyrics).trim();
    if (!L) continue;
    const title = t.title?.trim() ?? "";
    parts.push(title.length > 0 ? `${title}\n\n${L}` : L);
  }
  if (parts.length === 0) return null;
  return parts.join("\n\n---\n\n");
}

export async function persistCombinedReleaseLyricsFromStore(releaseId: string): Promise<void> {
  const st = useCreateReleaseDraftStore.getState();
  const parsed = tracksSchema.safeParse({ tracks: st.tracks });
  if (!parsed.success) return;
  const combined = buildCombinedReleaseLyrics(parsed.data.tracks);
  await withRequestTimeout(
    updateRelease(releaseId, { lyrics: combined }),
    SUPABASE_DB_OP_TIMEOUT_MS,
    USER_REQUEST_TIMEOUT_MESSAGE
  );
}

export async function syncTrackRowsAndReleaseLyrics(args: {
  releaseId: string;
  tracks: CreateTrack[];
  audioUrls: (string | null)[];
}): Promise<void> {
  const { releaseId, tracks, audioUrls } = args;
  for (let index = 0; index < tracks.length; index += 1) {
    const audioUrl = audioUrls[index]?.trim() ?? "";
    if (!audioUrl) continue;
    await withRequestTimeout(
      addReleaseTrack({
        releaseId,
        index,
        title: tracks[index].title,
        explicit: Boolean(tracks[index].explicit),
        audioUrl,
        lyrics: tracks[index].lyrics
      }),
      SUPABASE_DB_OP_TIMEOUT_MS,
      USER_REQUEST_TIMEOUT_MESSAGE
    );
  }
  const combined = buildCombinedReleaseLyrics(tracks);
  await withRequestTimeout(
    updateRelease(releaseId, { lyrics: combined }),
    SUPABASE_DB_OP_TIMEOUT_MS,
    USER_REQUEST_TIMEOUT_MESSAGE
  );
}

function buildTracksForResume(release: ReleaseRecord, rows: ReleaseTrackRow[]): CreateTrack[] {
  if (rows.length > 0) {
    return rows.map((r) => ({
      title: r.title,
      explicit: Boolean(r.explicit),
      lyrics: r.lyrics?.trim() ? r.lyrics : "",
      featuringArtistNames: []
    }));
  }
  if (release.release_type === "single") {
    return [
      {
        title: getReleaseDisplayTitle(release),
        explicit: Boolean(release.explicit),
        lyrics: "",
        featuringArtistNames: []
      }
    ];
  }
  return [
    { title: "", explicit: false, lyrics: "", featuringArtistNames: [] },
    { title: "", explicit: false, lyrics: "", featuringArtistNames: [] }
  ];
}

/** URL аудио из БД, по индексу трека (для подсказок после резюме). */
function buildTrackAudioUrlsFromDb(
  release: ReleaseRecord,
  rows: ReleaseTrackRow[],
  tracks: CreateTrack[]
): (string | null)[] {
  const len = tracks.length;
  const out: (string | null)[] = Array.from({ length: len }, () => null);
  if (rows.length > 0) {
    for (const r of rows) {
      if (r.index >= 0 && r.index < len) {
        out[r.index] = r.file_path ?? null;
      }
    }
    return out;
  }
  if (len === 1 && release.audio_url) {
    out[0] = release.audio_url;
  }
  return out;
}

/**
 * Следующий шаг мастера после резюме (как в useStepGuard): паспорт → обложка → треки → проверка.
 */
export function getResumeCreatePath(args: {
  metadata: CreateMetadata;
  artworkUrl: string | null;
  tracks: CreateTrack[];
}): "/create/metadata" | "/create/assets" | "/create/tracks" | "/create/review" {
  const { metadata, artworkUrl, tracks } = args;
  if (!isMetadataComplete(metadata)) return "/create/metadata";
  if (!isAssetsComplete({ artworkUrl })) return "/create/assets";
  if (!isTracksComplete({ tracks }, metadata.releaseType)) return "/create/tracks";
  return "/create/review";
}

/**
 * Загрузить черновик с сервера в стор и вернуть путь для router.push.
 * При ошибке пишет в submitError и возвращает null.
 */
export async function resumeDraftFromRelease(releaseId: string): Promise<string | null> {
  try {
    initUserContextInStore();
    const { record: existing, tracks: trackRows } = await getReleaseWithTracks(releaseId);

    if (existing.status !== "draft" && existing.status !== "pending") {
      useCreateReleaseDraftStore
        .getState()
        .setSubmitError("Продолжить можно только черновик или релиз до отправки на модерацию.");
      return null;
    }

    const store = useCreateReleaseDraftStore.getState();
    const uid = store.userId;
    if (uid != null) {
      const ownerId = Number(existing.user_id);
      const sessionId = Number(uid);
      const isOwner =
        Number.isFinite(ownerId) &&
        Number.isFinite(sessionId) &&
        ownerId === sessionId;
      const adminId = getAdminTelegramIdForUi();
      const isAdminUser =
        adminId !== null && Number.isFinite(sessionId) && telegramIdsEqual(sessionId, adminId);
      if (!isOwner && !isAdminUser) {
        useCreateReleaseDraftStore.getState().setSubmitError("Это не ваш релиз.");
        return null;
      }
    }

    const metadata = createMetadataFromReleaseRecord(existing);
    metadataHydrateSchema.parse(metadata);
    const featFromDb = featuringNamesFromCollaboratorsJson(existing.collaborators);
    const tracks = buildTracksForResume(existing, trackRows).map((t, i) => ({
      ...t,
      featuringArtistNames: i === 0 ? featFromDb : []
    }));
    const trackAudioUrlsFromDb = buildTrackAudioUrlsFromDb(existing, trackRows, tracks);

    store.resumeFromDraft({
      releaseId: existing.id,
      clientRequestId: existing.client_request_id ?? null,
      metadata,
      artworkUrl: existing.artwork_url ?? null,
      tracks,
      trackAudioUrlsFromDb,
      releaseArtistLinks: parseArtistLinksFromJson(existing.artist_links),
      moderatorNotes: existing.admin_notes ?? null
    });

    const next = getResumeCreatePath({
      metadata,
      artworkUrl: existing.artwork_url ?? null,
      tracks
    });
    return next;
  } catch (e: unknown) {
    useCreateReleaseDraftStore
      .getState()
      .setSubmitError(formatErrorMessage(e, "Не удалось открыть черновик."));
    return null;
  }
}

/**
 * Отклонённый релиз → снова в работу: сервер переводит failed → pending (файлы остаются),
 * затем открываем мастер с замечаниями модератора. Возвращает путь шага или null при ошибке.
 */
export async function reopenRejectedRelease(releaseId: string): Promise<string | null> {
  try {
    initUserContextInStore();
    const res = await fetch("/api/releases/reopen-rejected", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...getCreateReleaseApiAuthHeaders() },
      body: JSON.stringify({ releaseId })
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok || (json as { ok?: boolean } | null)?.ok !== true) {
      const msg =
        typeof (json as { error?: unknown } | null)?.error === "string"
          ? (json as { error: string }).error
          : "Не удалось открыть релиз для правок.";
      useCreateReleaseDraftStore.getState().setSubmitError(msg);
      return null;
    }
    trackFunnel("reopen_rejected", { releaseId });
    return await resumeDraftFromRelease(releaseId);
  } catch (e: unknown) {
    useCreateReleaseDraftStore
      .getState()
      .setSubmitError(formatErrorMessage(e, "Не удалось открыть релиз для правок."));
    return null;
  }
}

export async function hydrateFromReleaseId(releaseId: string): Promise<void> {
  try {
    initUserContextInStore();
    const existing = await getReleaseById(releaseId);
    const store = useCreateReleaseDraftStore.getState();
    const uid = store.userId;
    if (uid != null) {
      const ownerId = Number(existing.user_id);
      const sessionId = Number(uid);
      const isOwner =
        Number.isFinite(ownerId) &&
        Number.isFinite(sessionId) &&
        ownerId === sessionId;
      const adminId = getAdminTelegramIdForUi();
      const isAdminUser =
        adminId !== null && Number.isFinite(sessionId) && telegramIdsEqual(sessionId, adminId);
      if (!isOwner && !isAdminUser) {
        useCreateReleaseDraftStore.getState().setSubmitError("Это не ваш релиз.");
        return;
      }
    }
    const metadata = createMetadataFromReleaseRecord(existing);
    metadataHydrateSchema.parse(metadata);

    store.setReleaseId(existing.id);
    store.setClientRequestId(existing.client_request_id ?? null);
    store.setMetadata(metadata);
    store.setArtworkUrl(existing.artwork_url ?? null);
    store.setReleaseArtistLinks(parseArtistLinksFromJson(existing.artist_links));
    const featFromDb = featuringNamesFromCollaboratorsJson(existing.collaborators);
    const tr = store.tracks;
    const nextTracks =
      tr.length > 0
        ? tr.map((t, i) => ({
            ...t,
            featuringArtistNames: i === 0 ? featFromDb : (t.featuringArtistNames ?? [])
          }))
        : [
            {
              title: "",
              explicit: false,
              lyrics: "",
              featuringArtistNames: featFromDb
            }
          ];
    store.setTracks(nextTracks);
    store.setSubmitError(null);
  } catch (e: unknown) {
    useCreateReleaseDraftStore
      .getState()
      .setSubmitError(formatErrorMessage(e, "Не удалось загрузить релиз для редактирования."));
  }
}
