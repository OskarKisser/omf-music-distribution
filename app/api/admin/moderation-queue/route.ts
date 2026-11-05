import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminSupabaseClient } from "@/lib/admin-release-api-guard";
import { getTelegramAuthContextFromRequest } from "@/lib/api/with-telegram-auth";
import type { ReleaseRecord } from "@/repositories/releases.repo";
import { attachTracksToReleases, loadTracksForReleases } from "@/lib/server/admin-release-rows";
import type { ModerationQueueApiRow } from "@/types/admin";
import { loadSubmittedAt } from "@/lib/server/release-submitted-at";

export const dynamic = "force-dynamic";

async function handleModerationQueue(request: NextRequest): Promise<Response> {
  const guard = await requireAdminSupabaseClient(request, getTelegramAuthContextFromRequest(request));
  if (!guard.ok) return guard.response;

  const { data: releases, error: relErr } = await guard.supabase
    .from("releases")
    .select("*")
    // Отправленные на модерацию: в БД обычно `processing`, реже legacy `review`.
    .in("status", ["processing", "review"])
    .order("created_at", { ascending: true });

  if (relErr) {
    console.error("[admin/moderation-queue] releases:", relErr.message);
    return NextResponse.json({ ok: false, error: "Не удалось загрузить очередь." }, { status: 500 });
  }

  const list = (releases ?? []) as ReleaseRecord[];
  // Треки всех релизов очереди одним запросом: очередь опрашивается каждые 8 с.
  const ids = list.map((r) => r.id);
  // Когда ушёл на проверку — для «ждёт N ч» в строке очереди.
  const [tracks, submitted] = await Promise.all([
    loadTracksForReleases(guard.supabase, ids),
    loadSubmittedAt(guard.supabase, ids)
  ]);
  for (const r of list) {
    const at = submitted.get(r.id);
    if (at) (r as ReleaseRecord & { submitted_at?: string }).submitted_at = at;
  }
  if (tracks == null) {
    return NextResponse.json({ ok: false, error: "Не удалось загрузить треки." }, { status: 500 });
  }
  const rows: ModerationQueueApiRow[] = attachTracksToReleases(list, tracks);

  return NextResponse.json({ ok: true, rows });
}

export const GET = handleModerationQueue;
