"use client";

import { useCallback, useState } from "react";
import { Download, FileText, Loader2, Archive } from "lucide-react";
import { toast } from "sonner";
import { adminDownloadToDisk } from "@/features/admin/download";
import { triggerHaptic } from "@/lib/telegram";
import type { ReleaseTrackRow } from "@/repositories/releases/types";

type Props = {
  releaseId: string;
  hasArtwork: boolean;
  tracks: ReleaseTrackRow[];
  legacyAudioUrl: string | null;
  /** Сводный текст в `releases.lyrics` (если есть). */
  releaseLyrics?: string | null;
};

export function AdminReleaseDownloads({
  releaseId,
  hasArtwork,
  tracks,
  legacyAudioUrl,
  releaseLyrics
}: Props) {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const run = useCallback(
    async (key: string, path: string, filenameFallback: string) => {
      setBusyKey(key);
      try {
        await adminDownloadToDisk(path, filenameFallback);
        triggerHaptic("success");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Не удалось скачать файл";
        toast.error(msg);
        triggerHaptic("error");
      } finally {
        setBusyKey(null);
      }
    },
    []
  );

  const hasLegacyOnly =
    tracks.filter((t) => t.file_path && t.file_path.length > 0).length === 0 &&
    Boolean(legacyAudioUrl?.trim());

  const fileCount =
    (hasArtwork ? 1 : 0) +
    tracks.filter((t) => t.file_path?.trim()).length +
    tracks.filter((t) => t.lyrics?.trim()).length +
    (releaseLyrics?.trim() ? 1 : 0) +
    (hasLegacyOnly ? 1 : 0);

  return (
    <div className="space-y-2">
        <button
          type="button"
          disabled={busyKey !== null}
          onClick={() =>
            void run("zip", `/api/admin/releases/${releaseId}/bundle`, `release-${releaseId}.zip`)
          }
          className="omf-btn-secondary w-full gap-2 text-[15px] disabled:opacity-50"
        >
          {busyKey === "zip" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Archive className="h-4 w-4" />
          )}
          Скачать всё (ZIP)
        </button>
      <details className="group">
        <summary className="omf-focus flex cursor-pointer list-none items-center justify-between border-b border-omf-line py-3 text-[15px] text-omf-graphite [&::-webkit-details-marker]:hidden">
          Отдельные файлы · {fileCount}
          <span className="transition-transform group-open:rotate-90" aria-hidden>
            ›
          </span>
        </summary>
      <div className="flex flex-col">
        {hasArtwork && (
          <button
            type="button"
            disabled={busyKey !== null}
            onClick={() =>
              void run(
                "artwork",
                `/api/admin/releases/${releaseId}/download?kind=artwork`,
                `cover-${releaseId}`
              )
            }
            className="omf-focus flex w-full items-center gap-3 border-b border-omf-line py-3 text-left text-[15px] text-omf-ink disabled:opacity-50"
          >
            {busyKey === "artwork" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4 text-omf-graphite" />
            )}
            Обложка
          </button>
        )}

        {tracks.map((t, i) => {
          if (!t.file_path?.trim()) return null;
          const key = t.id ? `tr-${t.id}` : `idx-${t.index}-${i}`;
          const q = t.id
            ? `kind=audio&trackId=${encodeURIComponent(t.id)}`
            : `kind=audio&trackIndex=${encodeURIComponent(String(t.index))}`;
          return (
            <button
              key={key}
              type="button"
              disabled={busyKey !== null}
              onClick={() =>
                void run(
                  key,
                  `/api/admin/releases/${releaseId}/download?${q}`,
                  `track-${String(t.index + 1).padStart(2, "0")}-${releaseId}`
                )
              }
              className="omf-focus flex w-full items-center gap-3 border-b border-omf-line py-3 text-left text-[15px] text-omf-ink disabled:opacity-50"
            >
              {busyKey === key ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4 text-omf-graphite" />
              )}
              Аудио: {t.title.trim() || `Трек ${t.index + 1}`}
            </button>
          );
        })}

        {tracks.map((t, i) => {
          if (!t.lyrics?.trim()) return null;
          const key = t.id ? `lyrics-${t.id}` : `lyrics-idx-${t.index}-${i}`;
          const q = t.id
            ? `kind=lyrics&trackId=${encodeURIComponent(t.id)}`
            : `kind=lyrics&trackIndex=${encodeURIComponent(String(t.index))}`;
          return (
            <button
              key={key}
              type="button"
              disabled={busyKey !== null}
              onClick={() =>
                void run(
                  key,
                  `/api/admin/releases/${releaseId}/download?${q}`,
                  `track-${String(t.index + 1).padStart(2, "0")}-lyrics.txt`
                )
              }
              className="omf-focus flex w-full items-center gap-3 border-b border-omf-line py-3 text-left text-[15px] text-omf-ink disabled:opacity-50"
            >
              {busyKey === key ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4 text-omf-graphite" />
              )}
              Текст: {t.title.trim() || `Трек ${t.index + 1}`}
            </button>
          );
        })}

        {releaseLyrics?.trim() ? (
          <button
            type="button"
            disabled={busyKey !== null}
            onClick={() =>
              void run(
                "lyrics-release",
                `/api/admin/releases/${releaseId}/download?kind=lyrics`,
                `release-lyrics-${releaseId.slice(0, 8)}.txt`
              )
            }
            className="omf-focus flex w-full items-center gap-3 border-b border-omf-line py-3 text-left text-[15px] text-omf-ink disabled:opacity-50"
          >
            {busyKey === "lyrics-release" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4 text-omf-graphite" />
            )}
            Текст релиза
          </button>
        ) : null}

        {hasLegacyOnly && (
          <button
            type="button"
            disabled={busyKey !== null}
            onClick={() =>
              void run(
                "legacy-audio",
                `/api/admin/releases/${releaseId}/download?kind=audio`,
                `master-${releaseId}`
              )
            }
            className="omf-focus flex w-full items-center gap-3 border-b border-omf-line py-3 text-left text-[15px] text-omf-ink disabled:opacity-50"
          >
            {busyKey === "legacy-audio" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4 text-omf-graphite" />
            )}
            Аудио
          </button>
        )}

      </div>
      </details>
      <p className="text-[13px] leading-relaxed text-omf-faint">
        В архиве оригиналы без сжатия: аудио, обложка, тексты и metadata.json.
      </p>
    </div>
  );
}
