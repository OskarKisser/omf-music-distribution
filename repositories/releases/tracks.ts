import { z } from "zod";
import { releaseApiRequest } from "../../lib/api/release-client";
import { RELEASE_TYPE_VALUES } from "../../lib/db-enums";
import { sanitizeTrackFilename } from "../../lib/track-filename";
import { getReleaseWithTracks } from "./queries";
import type { ReleaseTrackRow } from "./types";

const trackInsertSchema = z.object({
  releaseId: z.string().min(1),
  index: z.number().int().nonnegative(),
  title: z.string().min(1).max(256).trim(),
  explicit: z.boolean(),
  /** Публичный URL после загрузки в Storage — в БД пишется в колонку `file_path`. */
  audioUrl: z.string().url(),
  lyrics: z.string().max(32000).nullable().optional(),
  originalFilename: z.string().nullable().optional()
});

export { RELEASE_TYPE_VALUES };

/**
 * Upsert трека (`release_id, index`) через `/api/releases/tracks`.
 * Владелец строки (`user_id` / `telegram_id` / `user_uuid`) копируется сервером из релиза.
 */
export async function addReleaseTrack(params: {
  releaseId: string;
  index: number;
  title: string;
  explicit: boolean;
  audioUrl: string;
  /** Текст песни; пустая строка → null в БД. */
  lyrics?: string | null;
  /** `File.name` загруженного WAV; без файла не передаётся. */
  originalFilename?: string;
}): Promise<void> {
  const { lyrics, originalFilename, ...rest } = params;
  const validated = trackInsertSchema.parse({
    ...rest,
    lyrics: lyrics == null || String(lyrics).trim() === "" ? null : String(lyrics).trim(),
    originalFilename: sanitizeTrackFilename(originalFilename)
  });
  await releaseApiRequest("/api/releases/tracks", { method: "POST", body: validated });
}

export async function cleanupReleaseTracks(releaseId: string): Promise<void> {
  await releaseApiRequest("/api/releases/tracks", { method: "DELETE", body: { releaseId } });
}

/**
 * Треки релиза из БД (для резюме черновика и отладки).
 * Сортировка по `index` по возрастанию.
 */
export async function getReleaseTracksByReleaseId(releaseId: string): Promise<ReleaseTrackRow[]> {
  const { tracks } = await getReleaseWithTracks(releaseId);
  return tracks;
}
