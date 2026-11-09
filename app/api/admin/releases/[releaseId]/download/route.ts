import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminSupabaseClient } from "@/lib/admin-release-api-guard";
import { getTelegramAuthContextFromRequest } from "@/lib/api/with-telegram-auth";
import {
  buildAdminLyricsTxtFilename,
  buildAdminReleaseAggregatedLyricsFilename
} from "@/lib/admin-track-lyrics";
import {
  contentDispositionAttachment,
  downloadStorageObjectBytes,
  guessFilenameFromUrl
} from "@/lib/supabase-storage-download";
import { buildTrackAudioFilename } from "@/lib/track-filename";
import { ensureWavBitDepthForDelivery } from "@/lib/wav-bit-depth";
import { loadPressKitRows } from "@/lib/server/press-kit";
import { buildPressPhotoFilename } from "@/lib/press-kit";
import { STORAGE_BUCKET_PRESS_PHOTOS } from "@/lib/storage-buckets";
import { getReleaseDisplayTitle, type ReleaseRecord } from "@/repositories/releases.repo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const paramsSchema = z.object({
  releaseId: z.string().uuid()
});

async function handleDownload(
  request: NextRequest,
  context: { params: { releaseId: string } }
): Promise<Response> {
  const guard = await requireAdminSupabaseClient(
    request,
    getTelegramAuthContextFromRequest(request)
  );
  if (!guard.ok) return guard.response;

  const parsedParams = paramsSchema.safeParse(context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, error: "Некорректный ID релиза." }, { status: 400 });
  }

  const { releaseId } = parsedParams.data;
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");

  if (kind !== "artwork" && kind !== "audio" && kind !== "lyrics" && kind !== "press_photo") {
    return NextResponse.json(
      { ok: false, error: "Укажите kind=artwork, kind=audio, kind=lyrics или kind=press_photo." },
      { status: 400 }
    );
  }

  const { data: row, error: loadErr } = await guard.supabase
    .from("releases")
    .select("*")
    .eq("id", releaseId)
    .maybeSingle();

  if (loadErr) {
    console.error("[admin/releases/download] load:", loadErr.message);
    return NextResponse.json({ ok: false, error: "Не удалось загрузить релиз." }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ ok: false, error: "Релиз не найден." }, { status: 404 });
  }

  try {
    if (kind === "lyrics") {
      const trackId = url.searchParams.get("trackId")?.trim() ?? "";
      const trackIndexRaw = url.searchParams.get("trackIndex");

      let text: string | null = null;
      let filename: string;

      if (trackId.length > 0) {
        const { data: tr, error: trErr } = await guard.supabase
          .from("tracks")
          .select("id, lyrics, title, index, release_id")
          .eq("id", trackId)
          .maybeSingle();

        if (trErr) {
          console.error("[admin/releases/download] lyrics track:", trErr.message);
          return NextResponse.json({ ok: false, error: "Не удалось загрузить трек." }, { status: 500 });
        }
        if (!tr || String(tr.release_id) !== releaseId) {
          return NextResponse.json({ ok: false, error: "Трек не найден." }, { status: 404 });
        }
        const raw = (tr.lyrics as string | null)?.trim() ?? "";
        text = raw.length > 0 ? raw : null;
        const idx = typeof tr.index === "number" ? tr.index : 0;
        filename = buildAdminLyricsTxtFilename({
          trackIndex: idx,
          title: String(tr.title ?? "")
        });
      } else if (trackIndexRaw !== null && trackIndexRaw !== "") {
        const idx = Number(trackIndexRaw);
        if (!Number.isFinite(idx) || idx < 0 || !Number.isInteger(idx)) {
          return NextResponse.json({ ok: false, error: "Некорректный trackIndex." }, { status: 400 });
        }
        const { data: tr, error: trErr } = await guard.supabase
          .from("tracks")
          .select("lyrics, title, index")
          .eq("release_id", releaseId)
          .eq("index", idx)
          .maybeSingle();

        if (trErr) {
          console.error("[admin/releases/download] lyrics by index:", trErr.message);
          return NextResponse.json({ ok: false, error: "Не удалось загрузить трек." }, { status: 500 });
        }
        const raw = (tr?.lyrics as string | null)?.trim() ?? "";
        text = raw.length > 0 ? raw : null;
        filename = buildAdminLyricsTxtFilename({
          trackIndex: idx,
          title: String(tr?.title ?? "")
        });
      } else {
        const raw = typeof row.lyrics === "string" ? row.lyrics.trim() : "";
        text = raw.length > 0 ? raw : null;
        filename = buildAdminReleaseAggregatedLyricsFilename(releaseId);
      }

      if (!text) {
        return NextResponse.json({ ok: false, error: "Текст песни не заполнен." }, { status: 404 });
      }

      return new NextResponse(new TextEncoder().encode(text), {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": contentDispositionAttachment(filename),
          "Cache-Control": "no-store"
        }
      });
    }

    if (kind === "press_photo") {
      const [kit] = await loadPressKitRows(guard.supabase, [releaseId]);
      const photoPath = kit?.photo_path?.trim();
      if (!photoPath) {
        return NextResponse.json({ ok: false, error: "Фото артиста не загружено." }, { status: 404 });
      }
      const { data, error } = await guard.supabase.storage.from(STORAGE_BUCKET_PRESS_PHOTOS).download(photoPath);
      if (error || !data) {
        throw new Error(error?.message ?? "Не удалось скачать фото.");
      }
      const ext = photoPath.split(".").pop() ?? "jpg";
      return new NextResponse(await data.arrayBuffer(), {
        headers: {
          "Content-Type": data.type || "application/octet-stream",
          "Content-Disposition": contentDispositionAttachment(
            buildPressPhotoFilename(row.artist_name as string | null, getReleaseDisplayTitle(row as ReleaseRecord), ext)
          ),
          "Cache-Control": "no-store"
        }
      });
    }

    if (kind === "artwork") {
      const artworkUrl = row.artwork_url as string | null;
      if (!artworkUrl?.trim()) {
        return NextResponse.json({ ok: false, error: "Обложка не загружена." }, { status: 404 });
      }
      const { data, contentType } = await downloadStorageObjectBytes(guard.supabase, artworkUrl.trim());
      const filename = guessFilenameFromUrl(artworkUrl, `cover-${releaseId}`);
      return new NextResponse(data, {
        headers: {
          "Content-Type": contentType ?? "application/octet-stream",
          "Content-Disposition": contentDispositionAttachment(filename),
          "Cache-Control": "no-store"
        }
      });
    }

    const trackId = url.searchParams.get("trackId")?.trim() ?? "";
    const trackIndexRaw = url.searchParams.get("trackIndex");

    let audioUrl: string | null = null;
    let filenameBase = `release-${releaseId}`;
    let trackNames: { originalFilename: string | null; title: string | null } | null = null;

    if (trackId.length > 0) {
      const { data: tr, error: trErr } = await guard.supabase
        .from("tracks")
        .select("*")
        .eq("id", trackId)
        .maybeSingle();

      if (trErr) {
        console.error("[admin/releases/download] track:", trErr.message);
        return NextResponse.json({ ok: false, error: "Не удалось загрузить трек." }, { status: 500 });
      }
      if (!tr || String(tr.release_id) !== releaseId) {
        return NextResponse.json({ ok: false, error: "Трек не найден." }, { status: 404 });
      }
      audioUrl = (tr.file_path as string | null)?.trim() ?? null;
      trackNames = { originalFilename: tr.original_filename, title: tr.title };
      const idx = typeof tr.index === "number" ? tr.index : 0;
      filenameBase = `track-${String(idx + 1).padStart(2, "0")}-${releaseId}`;
    } else if (trackIndexRaw !== null && trackIndexRaw !== "") {
      const idx = Number(trackIndexRaw);
      if (!Number.isFinite(idx) || idx < 0 || !Number.isInteger(idx)) {
        return NextResponse.json({ ok: false, error: "Некорректный trackIndex." }, { status: 400 });
      }
      const { data: tr, error: trErr } = await guard.supabase
        .from("tracks")
        .select("*")
        .eq("release_id", releaseId)
        .eq("index", idx)
        .maybeSingle();

      if (trErr) {
        console.error("[admin/releases/download] track by index:", trErr.message);
        return NextResponse.json({ ok: false, error: "Не удалось загрузить трек." }, { status: 500 });
      }
      audioUrl = (tr?.file_path as string | null)?.trim() ?? null;
      trackNames = { originalFilename: tr?.original_filename ?? null, title: tr?.title ?? null };
      filenameBase = `track-${String(idx + 1).padStart(2, "0")}-${releaseId}`;
    } else {
      audioUrl = (row.audio_url as string | null)?.trim() ?? null;
      filenameBase = `master-${releaseId}`;
    }

    if (!audioUrl) {
      return NextResponse.json({ ok: false, error: "Аудиофайл не найден." }, { status: 404 });
    }

    const { data, contentType } = await downloadStorageObjectBytes(guard.supabase, audioUrl);
    const guessedName = guessFilenameFromUrl(audioUrl, filenameBase);
    const filename = trackNames
      ? buildTrackAudioFilename({ ...trackNames, fallback: guessedName })
      : guessedName;

    return new NextResponse(ensureWavBitDepthForDelivery(data), {
      headers: {
        "Content-Type": contentType ?? "application/octet-stream",
        "Content-Disposition": contentDispositionAttachment(filename),
        "Cache-Control": "no-store"
      }
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Download failed";
    console.error("[admin/releases/download]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}

export async function GET(
  request: NextRequest,
  routeContext: { params: { releaseId: string } }
): Promise<Response> {
  return handleDownload(request, routeContext);
}
