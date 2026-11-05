import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { resolveReleaseActor } from "@/lib/api/resolve-submit-actor";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { isReleaseActorOwner } from "@/lib/release-ownership.server";
import { invalidateMyReleasesCache } from "@/lib/server/release-list-cache";
import { notifyAdminTakedownRequested } from "@/lib/admin-notify.server";
import { canRequestTakedown } from "@/lib/release-takedown";
import { getReleaseDisplayTitle, type ReleaseRecord } from "@/repositories/releases.repo";

export const runtime = "nodejs";

const bodySchema = z.object({
  releaseId: z.string().uuid(),
  reason: z.string().trim().max(500).optional()
});

/**
 * Артист просит снять релиз с площадок. Статус не меняем: релиз остаётся на площадках,
 * пока модератор не снимет его у дистрибьютора и не переведёт в `removed`.
 */
async function handleRequestTakedown(request: NextRequest): Promise<Response> {
  const actor = await resolveReleaseActor(request);
  if (!actor) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const admin = createSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Некорректное тело запроса." }, { status: 400 });
  }
  const { releaseId, reason } = parsed.data;

  const { data: row, error: loadErr } = await admin
    .from("releases")
    .select("id, user_id, telegram_id, user_uuid, status, title, track_name, artist_name, takedown_requested_at")
    .eq("id", releaseId)
    .maybeSingle();
  if (loadErr) {
    console.error("[releases/request-takedown] load:", loadErr.message);
    return NextResponse.json({ ok: false, error: "Не удалось загрузить релиз." }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ ok: false, error: "Релиз не найден." }, { status: 404 });
  }
  if (!(await isReleaseActorOwner(admin, row as Record<string, unknown>, actor))) {
    return NextResponse.json({ ok: false, error: "Нет доступа к этому релизу." }, { status: 403 });
  }

  const record = row as unknown as ReleaseRecord;
  // Повторное нажатие — не дёргаем модератора второй раз.
  if (record.takedown_requested_at) {
    return NextResponse.json({ ok: true, alreadyRequested: true });
  }
  if (!canRequestTakedown(record.status)) {
    return NextResponse.json(
      { ok: false, error: "Удалить с площадок можно только отправленный релиз." },
      { status: 409 }
    );
  }

  const { error: updErr } = await admin
    .from("releases")
    .update({ takedown_requested_at: new Date().toISOString(), takedown_reason: reason || null })
    .eq("id", releaseId)
    .is("takedown_requested_at", null);
  if (updErr) {
    console.error("[releases/request-takedown] update:", updErr.message);
    return NextResponse.json({ ok: false, error: "Не удалось отправить запрос." }, { status: 500 });
  }

  await invalidateMyReleasesCache(row as Record<string, unknown>);
  await notifyAdminTakedownRequested({
    releaseId,
    title: getReleaseDisplayTitle(record),
    artist: String(record.artist_name ?? ""),
    telegramId: record.telegram_id,
    reason,
    appOrigin: request.nextUrl.origin
  });
  return NextResponse.json({ ok: true });
}

export const POST = handleRequestTakedown;
