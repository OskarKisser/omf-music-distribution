import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, loadOwnedRelease, readJsonBody } from "@/lib/api/release-owner-route";
import { notifyAdminPressKitSaved } from "@/lib/admin-notify.server";
import {
  isOwnPressPhotoPath,
  isPitchingOpen,
  normalizePressText,
  pressKitNoticeKind,
  pressTextError
} from "@/lib/press-kit";
import { loadPressKit, loadPressKitRows, pressPhotoExists, removePressPhotos } from "@/lib/server/press-kit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const paramsSchema = z.object({ releaseId: z.string().uuid() });

const bodySchema = z
  .object({
    /** Не передан — текст не меняем; null или пусто — стираем. */
    pressText: z.string().max(2000).nullable().optional(),
    /** Путь из `photo-upload`; null — убрать фото. */
    photoPath: z.string().max(200).nullable().optional()
  })
  .refine((b) => b.pressText !== undefined || b.photoPath !== undefined, "Нечего сохранять.");

const OWNER_COLUMNS = "id, user_id, telegram_id, user_uuid, status, smart_link, title, track_name, artist_name";

async function loadOpenRelease(request: NextRequest, releaseIdRaw: string) {
  const parsed = paramsSchema.safeParse({ releaseId: releaseIdRaw });
  if (!parsed.success) return { ok: false as const, response: jsonError(400, "Некорректный ID релиза.") };
  const owned = await loadOwnedRelease(request, parsed.data.releaseId, { columns: OWNER_COLUMNS });
  if (!owned.ok) return owned;
  const row = owned.value.row;
  if (!isPitchingOpen(row.status as string | null, row.smart_link as string | null)) {
    return {
      ok: false as const,
      response: jsonError(409, "Питчинг откроется, когда релиз выпустят и появится ссылка.")
    };
  }
  return { ok: true as const, releaseId: parsed.data.releaseId, admin: owned.value.admin, row };
}

/** Пресс-релиз владельца: текст, превью фото, дата обновления. */
async function handleGet(request: NextRequest, ctx: { params: { releaseId: string } }): Promise<Response> {
  const open = await loadOpenRelease(request, ctx.params.releaseId);
  if (!open.ok) return open.response;
  const kit = await loadPressKit(open.admin, open.releaseId);
  return NextResponse.json({ ok: true, kit });
}

/** Сохранить текст и/или фото. Фото клиент сначала грузит по ссылке из `photo-upload`. */
async function handlePost(request: NextRequest, ctx: { params: { releaseId: string } }): Promise<Response> {
  const open = await loadOpenRelease(request, ctx.params.releaseId);
  if (!open.ok) return open.response;
  const { admin, releaseId, row } = open;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.value);
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректный запрос.");

  const patch: { press_text?: string | null; photo_path?: string | null } = {};

  if (parsed.data.pressText !== undefined) {
    const text = normalizePressText(parsed.data.pressText);
    const err = pressTextError(text);
    if (err) return jsonError(400, err);
    patch.press_text = text;
  }

  if (parsed.data.photoPath !== undefined) {
    const path = parsed.data.photoPath?.trim() || null;
    if (path) {
      if (!isOwnPressPhotoPath(path, releaseId)) return jsonError(400, "Некорректный путь фото.");
      if (!(await pressPhotoExists(admin, path))) return jsonError(400, "Фото не загрузилось, попробуй ещё раз.");
    }
    patch.photo_path = path;
  }

  const [existing] = await loadPressKitRows(admin, [releaseId]);
  const savedAt = new Date();
  const { error } = await admin
    .from("release_press_kits")
    .upsert({ release_id: releaseId, ...patch, updated_at: savedAt.toISOString() }, { onConflict: "release_id" });
  if (error) {
    console.error("[releases/press-kit POST] upsert:", error.message);
    return jsonError(500, "Не удалось сохранить питчинг.");
  }

  // Фото заменили или убрали — старый файл больше не нужен.
  if (patch.photo_path !== undefined && existing?.photo_path !== patch.photo_path) {
    await removePressPhotos(admin, releaseId, patch.photo_path);
  }

  const next = {
    press_text: patch.press_text !== undefined ? patch.press_text : (existing?.press_text ?? null),
    photo_path: patch.photo_path !== undefined ? patch.photo_path : (existing?.photo_path ?? null)
  };
  const noticeKind = pressKitNoticeKind(existing, next, savedAt.getTime());
  if (noticeKind) {
    await notifyAdminPressKitSaved({
      releaseId,
      kind: noticeKind,
      title: String(row.title ?? "").trim() || String(row.track_name ?? "").trim(),
      artist: String(row.artist_name ?? "").trim(),
      telegramId: row.telegram_id as string | number | null,
      pressText: next.press_text,
      hasPhoto: Boolean(next.photo_path),
      appOrigin: request.nextUrl.origin
    });
  }

  const kit = await loadPressKit(admin, releaseId);
  return NextResponse.json({ ok: true, kit });
}

export const GET = handleGet;
export const POST = handlePost;
