import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import JSZip from "jszip";
import { z } from "zod";
import { buildReleaseExportPayload, type AdminReleaseRow } from "@/lib/admin-release-metadata";
import { requireAdminSupabaseClient } from "@/lib/admin-release-api-guard";
import { getTelegramAuthContextFromRequest } from "@/lib/api/with-telegram-auth";
import type { ReleaseTrackRow } from "@/repositories/releases/types";
import { buildAdminLyricsTxtFilename } from "@/lib/admin-track-lyrics";
import {
  contentDispositionAttachment,
  downloadStorageObjectBytes,
  guessFilenameFromUrl
} from "@/lib/supabase-storage-download";
import { buildTrackAudioFilename, claimUniqueFilename } from "@/lib/track-filename";
import { ensureWavBitDepthForDelivery } from "@/lib/wav-bit-depth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const paramsSchema = z.object({
  releaseId: z.string().uuid()
});

async function handleBundle(
  request: NextRequest,
  routeContext: { params: { releaseId: string } }
): Promise<Response> {
  const guard = await requireAdminSupabaseClient(
    request,
    getTelegramAuthContextFromRequest(request)
  );
  if (!guard.ok) return guard.response;

  const parsedParams = paramsSchema.safeParse(routeContext.params);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, error: "Некорректный ID релиза." }, { status: 400 });
  }

  const { releaseId } = parsedParams.data;

  const { data: row, error: loadErr } = await guard.supabase
    .from("releases")
    .select("*")
    .eq("id", releaseId)
    .maybeSingle();

  if (loadErr) {
    console.error("[admin/releases/bundle] load:", loadErr.message);
    return NextResponse.json({ ok: false, error: "Не удалось загрузить релиз." }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ ok: false, error: "Релиз не найден." }, { status: 404 });
  }

  const { data: trackRows, error: tracksErr } = await guard.supabase
    .from("tracks")
    .select("*")
    .eq("release_id", releaseId)
    .order("index", { ascending: true });

  if (tracksErr) {
    console.error("[admin/releases/bundle] tracks:", tracksErr.message);
    return NextResponse.json({ ok: false, error: "Не удалось загрузить треки." }, { status: 500 });
  }

  const tracks = (trackRows ?? []) as ReleaseTrackRow[];
  const exportDoc = buildReleaseExportPayload(row as AdminReleaseRow, tracks);

  const zip = new JSZip();
  zip.file("metadata.json", `${JSON.stringify(exportDoc, null, 2)}\n`);

  type LyricsZipFile = { path: string; content: string };
  const lyricsParts: LyricsZipFile[] = [];
  for (const t of tracks) {
    const raw = typeof t.lyrics === "string" ? t.lyrics.trim() : "";
    if (!raw) continue;
    const idx = typeof t.index === "number" ? t.index : 0;
    lyricsParts.push({
      path: buildAdminLyricsTxtFilename({
        trackIndex: idx,
        title: String(t.title ?? "")
      }),
      content: raw
    });
  }
  const agg =
    row && typeof (row as { lyrics?: string }).lyrics === "string"
      ? (row as { lyrics: string }).lyrics.trim()
      : "";
  if (agg.length > 0) {
    lyricsParts.push({ path: "release-aggregated.txt", content: agg });
  }
  if (lyricsParts.length > 0) {
    const lyricsFolder = zip.folder("lyrics");
    if (lyricsFolder) {
      for (const f of lyricsParts) {
        lyricsFolder.file(f.path, f.content);
      }
    }
  }

  const audioFolder = zip.folder("audio");
  if (!audioFolder) {
    return NextResponse.json({ ok: false, error: "ZIP: не удалось создать папку." }, { status: 500 });
  }

  try {
    if (tracks.length > 0) {
      const usedAudioNames = new Set<string>();
      for (const t of tracks) {
        const url = typeof t.file_path === "string" ? t.file_path.trim() : "";
        if (!url) continue;
        const idx = typeof t.index === "number" ? t.index : 0;
        const { data } = await downloadStorageObjectBytes(guard.supabase, url);
        const fallback = `track-${String(idx + 1).padStart(2, "0")}`;
        const name = claimUniqueFilename(
          buildTrackAudioFilename({
            originalFilename: t.original_filename,
            title: t.title,
            fallback: guessFilenameFromUrl(url, fallback)
          }),
          usedAudioNames
        );
        audioFolder.file(name, new Uint8Array(ensureWavBitDepthForDelivery(data)), { binary: true });
      }
    } else {
      const legacy = typeof row.audio_url === "string" ? row.audio_url.trim() : "";
      if (legacy) {
        const { data } = await downloadStorageObjectBytes(guard.supabase, legacy);
        const name = guessFilenameFromUrl(legacy, `master-${releaseId}`);
        audioFolder.file(name, new Uint8Array(ensureWavBitDepthForDelivery(data)), { binary: true });
      }
    }

    const artworkUrl = typeof row.artwork_url === "string" ? row.artwork_url.trim() : "";
    if (artworkUrl) {
      const { data } = await downloadStorageObjectBytes(guard.supabase, artworkUrl);
      const artName = guessFilenameFromUrl(artworkUrl, `cover-${releaseId}`);
      zip.file(`artwork/${artName}`, new Uint8Array(data), { binary: true });
    }

    const out = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });

    const zipName = `release-${releaseId}.zip`;
    return new NextResponse(Buffer.from(out), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDispositionAttachment(zipName),
        "Cache-Control": "no-store"
      }
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Bundle failed";
    console.error("[admin/releases/bundle]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}

export async function GET(
  request: NextRequest,
  routeContext: { params: { releaseId: string } }
): Promise<Response> {
  return handleBundle(request, routeContext);
}
