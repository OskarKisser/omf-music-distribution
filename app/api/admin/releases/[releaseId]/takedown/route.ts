import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminSupabaseClient } from "@/lib/admin-release-api-guard";
import { getTelegramAuthContextFromRequest } from "@/lib/api/with-telegram-auth";
import { invalidateMyReleasesCache } from "@/lib/server/release-list-cache";
import { notifyArtist } from "@/lib/server/artist-notify";
import { releaseRemovedMessage } from "@/lib/server/release-notify-texts";
import { canConfirmTakedown } from "@/lib/release-takedown";
import { getReleaseDisplayTitle, type ReleaseRecord } from "@/repositories/releases.repo";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ releaseId: z.string().uuid() });

/**
 * Модератор снял релиз у дистрибьютора: статус → `removed`, артисту сообщение в бот.
 * Работает и без запроса артиста (например, попросил в личке).
 */
export async function POST(
  request: NextRequest,
  routeContext: { params: { releaseId: string } }
): Promise<Response> {
  const guard = await requireAdminSupabaseClient(request, getTelegramAuthContextFromRequest(request));
  if (!guard.ok) return guard.response;

  const parsed = paramsSchema.safeParse(routeContext.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Некорректный ID релиза." }, { status: 400 });
  }
  const { releaseId } = parsed.data;

  const { data: row, error: loadErr } = await guard.supabase
    .from("releases")
    .select("id, status, title, track_name, telegram_id, user_uuid, user_id")
    .eq("id", releaseId)
    .maybeSingle();
  if (loadErr) {
    console.error("[admin/takedown] load:", loadErr.message);
    return NextResponse.json({ ok: false, error: "Не удалось загрузить релиз." }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ ok: false, error: "Релиз не найден." }, { status: 404 });
  }
  const record = row as unknown as ReleaseRecord;
  if (record.status === "removed") {
    return NextResponse.json({ ok: true, alreadyRemoved: true });
  }
  if (!canConfirmTakedown(record.status)) {
    return NextResponse.json(
      { ok: false, error: "Снять можно только отправленный релиз." },
      { status: 409 }
    );
  }

  const { error: updErr } = await guard.supabase
    .from("releases")
    .update({ status: "removed" })
    .eq("id", releaseId);
  if (updErr) {
    console.error("[admin/takedown] update:", updErr.message);
    return NextResponse.json({ ok: false, error: "Не удалось обновить статус." }, { status: 500 });
  }

  await invalidateMyReleasesCache(row as Record<string, unknown>);
  await notifyArtist(record, releaseRemovedMessage(getReleaseDisplayTitle(record)));
  return NextResponse.json({ ok: true });
}
