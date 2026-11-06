import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminSupabaseClient } from "@/lib/admin-release-api-guard";
import { getTelegramAuthContextFromRequest } from "@/lib/api/with-telegram-auth";
import { featuringNamesFromCollaboratorsJson } from "@/lib/collaborators";
import { loadAcceptedAt } from "@/lib/server/release-accepted-at";
import type { PressKitRow } from "@/lib/server/press-kit";
import type { AdminCatalogRelease } from "@/types/admin";

export const dynamic = "force-dynamic";

/** Потолок на случай роста; при приближении — пагинация. */
const LIMIT = 2000;

type ReleaseRow = {
  id: string;
  title: string | null;
  track_name: string | null;
  artist_name: string | null;
  collaborators: unknown;
  release_type: AdminCatalogRelease["release_type"] | null;
  genre: string | null;
  artwork_url: string | null;
  smart_link: string | null;
  upc: string | null;
  created_at: string;
};

type TrackRow = {
  release_id: string;
  index: number | null;
  title: string | null;
  explicit: boolean | null;
  duration: number | null;
};

/** Каталог: все принятые (отгруженные на площадки) релизы с треками, свежие сверху. */
async function handleCatalog(request: NextRequest): Promise<Response> {
  const guard = await requireAdminSupabaseClient(request, getTelegramAuthContextFromRequest(request));
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.supabase
    .from("releases")
    .select(
      "id, title, track_name, artist_name, collaborators, release_type, genre, artwork_url, smart_link, upc, created_at"
    )
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) {
    console.error("[admin/catalog] releases:", error.message);
    return NextResponse.json({ ok: false, error: "Не удалось загрузить каталог." }, { status: 500 });
  }
  const releases = (data ?? []) as ReleaseRow[];
  const ids = releases.map((r) => r.id);

  const tracksByRelease = new Map<string, TrackRow[]>();
  if (ids.length > 0) {
    const { data: tracks, error: trErr } = await guard.supabase
      .from("tracks")
      .select("release_id, index, title, explicit, duration")
      .in("release_id", ids)
      .order("index", { ascending: true });
    if (trErr) {
      console.error("[admin/catalog] tracks:", trErr.message);
      return NextResponse.json({ ok: false, error: "Не удалось загрузить треки." }, { status: 500 });
    }
    for (const t of (tracks ?? []) as TrackRow[]) {
      const arr = tracksByRelease.get(t.release_id);
      if (arr) arr.push(t);
      else tracksByRelease.set(t.release_id, [t]);
    }
  }
  const acceptedAt = await loadAcceptedAt(guard.supabase, ids);
  // Питчингов не больше, чем релизов: берём все строки, без длинного `in (...)` на тысячи id.
  const pitchedAt = new Map<string, string>();
  const { data: kits, error: kitErr } = await guard.supabase
    .from("release_press_kits")
    .select("release_id, press_text, photo_path, updated_at");
  if (kitErr) console.error("[admin/catalog] press kits:", kitErr.message);
  for (const kit of (kits ?? []) as PressKitRow[]) {
    if ((kit.press_text?.trim() || kit.photo_path) && kit.updated_at) pitchedAt.set(kit.release_id, kit.updated_at);
  }

  const rows: AdminCatalogRelease[] = releases.map((r) => {
    const title = r.title?.trim() || r.track_name?.trim() || "Без названия";
    const tracks = (tracksByRelease.get(r.id) ?? [])
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((t) => ({ title: t.title?.trim() || "", explicit: t.explicit === true, duration: t.duration ?? null }));
    return {
      id: r.id,
      title,
      artist_name: r.artist_name?.trim() || "—",
      featuring: featuringNamesFromCollaboratorsJson(r.collaborators),
      release_type: r.release_type ?? "single",
      genre: r.genre?.trim() || null,
      artwork_url: r.artwork_url,
      smart_link: r.smart_link?.trim() || null,
      upc: r.upc?.trim() || null,
      accepted_at: acceptedAt.get(r.id) ?? r.created_at,
      tracks: tracks.length > 0 ? tracks : [{ title, explicit: false, duration: null }],
      pitched_at: pitchedAt.get(r.id) ?? null
    };
  });
  rows.sort((a, b) => b.accepted_at.localeCompare(a.accepted_at));

  return NextResponse.json({ ok: true, rows, truncated: releases.length >= LIMIT });
}

export const GET = handleCatalog;
