import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminSupabaseClient } from "@/lib/admin-release-api-guard";
import { getTelegramAuthContextFromRequest } from "@/lib/api/with-telegram-auth";
import { getReleaseDisplayTitle, type ReleaseRecord } from "@/repositories/releases.repo";
import { approveRelease } from "@/lib/server/release-approve";
import { escapeHtml } from "@/lib/telegram-bot.server";
import { notifyArtist } from "@/lib/server/artist-notify";
import { isMissingReleasesColumnError } from "@/lib/errors";
import { invalidateMyReleasesCache } from "@/lib/server/release-list-cache";

const bodySchema = z.object({
  releaseId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  comment: z.string().max(2000).optional(),
  reasonKeys: z.array(z.string().max(40)).max(10).optional()
});

async function notifyArtistOnReject(
  record: ReleaseRecord,
  comment?: string
): Promise<void> {
  const titleRaw = getReleaseDisplayTitle(record);
  const title = escapeHtml(titleRaw.length > 0 ? titleRaw : "релиз");

  const reason = escapeHtml((comment && comment.trim()) || "Отклонено модератором");
  await notifyArtist(
    record,
    `❌ <b>Релиз «${title}» отклонён модерацией.</b>\n\nПричина: ${reason}\n\nОткрой релиз в приложении и нажми «Исправить и отправить снова» — файлы уже загружены.`
  );
}

async function handleUpdateReleaseStatus(
  request: NextRequest
): Promise<Response> {
  const guard = await requireAdminSupabaseClient(
    request,
    getTelegramAuthContextFromRequest(request)
  );
  if (!guard.ok) return guard.response;
  const supabase = guard.supabase;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Некорректное тело запроса." }, { status: 400 });
  }

  const { releaseId, action, comment, reasonKeys } = parsed.data;

  const { data: row, error: loadErr } = await supabase
    .from("releases")
    .select("*")
    .eq("id", releaseId)
    .maybeSingle();

  if (loadErr) {
    console.error("[admin/update-release-status] load:", loadErr.message);
    return NextResponse.json({ ok: false, error: "Не удалось загрузить релиз." }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ ok: false, error: "Релиз не найден." }, { status: 404 });
  }

  const status = row.status as string;
  if (status !== "processing") {
    return NextResponse.json(
      { ok: false, error: "Релиз не в очереди модерации (ожидался статус processing)." },
      { status: 409 }
    );
  }

  // «Принять» — общая функция с карточкой «Пульт» (lib/server/release-approve).
  if (action === "approve") {
    const res = await approveRelease(supabase, releaseId);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status });
    return NextResponse.json({ ok: true, record: res.record });
  }

  const msg = (comment && comment.trim()) || "Отклонено модератором";

  const rejectPayload: Record<string, unknown> = {
    status: "failed",
    error_message: msg,
    admin_notes: msg,
    rejection_reasons: reasonKeys ?? [],
    rejection_count: Number((row as { rejection_count?: number | null }).rejection_count ?? 0) + 1
  };
  let { data: updated, error: updErr } = await supabase
    .from("releases")
    .update(rejectPayload)
    .eq("id", releaseId)
    .select("*")
    .maybeSingle();

  // Миграция с rejection_* может быть ещё не применена — отклоняем без этих полей.
  if (
    updErr &&
    (isMissingReleasesColumnError(updErr, "rejection_reasons") ||
      isMissingReleasesColumnError(updErr, "rejection_count"))
  ) {
    const { rejection_reasons: _r, rejection_count: _c, ...legacy } = rejectPayload;
    ({ data: updated, error: updErr } = await supabase
      .from("releases")
      .update(legacy)
      .eq("id", releaseId)
      .select("*")
      .maybeSingle());
  }

  if (updErr) {
    console.error("[admin/update-release-status] reject:", updErr.message);
    return NextResponse.json({ ok: false, error: "Не удалось отклонить релиз." }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ ok: false, error: "Не удалось обновить релиз." }, { status: 500 });
  }

  await invalidateMyReleasesCache(updated as Record<string, unknown>);
  await notifyArtistOnReject(updated as ReleaseRecord, msg);
  return NextResponse.json({ ok: true, record: updated as ReleaseRecord });
}

export const POST = handleUpdateReleaseStatus;
