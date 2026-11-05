import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminSupabaseClient } from "@/lib/admin-release-api-guard";
import { getTelegramAuthContextFromRequest } from "@/lib/api/with-telegram-auth";
import { invalidateMyReleasesCache } from "@/lib/server/release-list-cache";
import { STORAGE_BUCKET_ARTWORK } from "@/lib/storage-buckets";
import { RELEASE_FILE_LIMITS } from "@/repositories/releases/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const paramsSchema = z.object({ releaseId: z.string().uuid() });
const ticketSchema = z.object({ mime: z.enum(["image/jpeg", "image/png"]), size: z.number().int().positive() });
const confirmSchema = z.object({ path: z.string().min(1).max(300) });

const MAX_BYTES = RELEASE_FILE_LIMITS.artworkMaxMb * 1024 * 1024;

type Row = { id: string; artwork_url: string | null; user_id: number | null; telegram_id: number | null; user_uuid: string | null };

/** Папка обложки: та же, что у текущей (`<id>/<releaseId>/cover.ext`), иначе по владельцу. */
function coverDir(row: Row): string {
  const marker = `/object/public/${STORAGE_BUCKET_ARTWORK}/`;
  const url = row.artwork_url ?? "";
  if (url.includes(marker)) {
    const key = decodeURIComponent(url.split(marker)[1].split("?")[0]);
    const parts = key.split("/");
    if (parts.length === 3 && /^\d+$/.test(parts[0]) && parts[1] === row.id) return `${parts[0]}/${row.id}`;
  }
  const owner = row.user_id ?? row.telegram_id ?? 0;
  return `${owner}/${row.id}`;
}

async function load(request: NextRequest, params: { releaseId: string }) {
  const guard = await requireAdminSupabaseClient(request, getTelegramAuthContextFromRequest(request));
  if (!guard.ok) return { ok: false as const, response: guard.response };
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "Некорректный ID релиза." }, { status: 400 }) };
  }
  const { data, error } = await guard.supabase
    .from("releases")
    .select("id, artwork_url, user_id, telegram_id, user_uuid")
    .eq("id", parsed.data.releaseId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("[admin/artwork] load:", error.message);
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: error ? "Не удалось загрузить релиз." : "Релиз не найден." }, { status: error ? 500 : 404 })
    };
  }
  return { ok: true as const, supabase: guard.supabase, row: data as unknown as Row };
}

async function json(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/**
 * Ссылка на загрузку новой обложки: файл идёт из браузера прямо в Storage,
 * мимо Vercel (тело запроса там до 4,5 МБ, а обложки бывают до 35 МБ).
 */
export async function POST(request: NextRequest, ctx: { params: { releaseId: string } }): Promise<Response> {
  const loaded = await load(request, ctx.params);
  if (!loaded.ok) return loaded.response;

  const body = ticketSchema.safeParse(await json(request));
  if (!body.success) return NextResponse.json({ ok: false, error: "Нужна обложка в JPG или PNG." }, { status: 400 });
  if (body.data.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: `Обложка больше ${RELEASE_FILE_LIMITS.artworkMaxMb} МБ.` }, { status: 400 });
  }

  const path = `${coverDir(loaded.row)}/cover.${body.data.mime === "image/png" ? "png" : "jpg"}`;
  const { data, error } = await loaded.supabase.storage
    .from(STORAGE_BUCKET_ARTWORK)
    .createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    console.error("[admin/artwork] ticket:", error?.message);
    return NextResponse.json({ ok: false, error: "Не удалось подготовить загрузку." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, path: data.path, token: data.token, bucket: STORAGE_BUCKET_ARTWORK });
}

/** Файл загружен: ставим новую обложку релизу (с меткой версии, чтобы кэш не показывал старую). */
export async function PATCH(request: NextRequest, ctx: { params: { releaseId: string } }): Promise<Response> {
  const loaded = await load(request, ctx.params);
  if (!loaded.ok) return loaded.response;
  const { row, supabase } = loaded;

  const body = confirmSchema.safeParse(await json(request));
  if (!body.success) return NextResponse.json({ ok: false, error: "Некорректный запрос." }, { status: 400 });
  const dir = coverDir(row);
  const { path } = body.data;
  if (path !== `${dir}/cover.jpg` && path !== `${dir}/cover.png`) {
    return NextResponse.json({ ok: false, error: "Файл не от этого релиза." }, { status: 400 });
  }

  // Старая обложка с другим расширением больше не нужна.
  const other = path.endsWith(".png") ? `${dir}/cover.jpg` : `${dir}/cover.png`;
  await supabase.storage.from(STORAGE_BUCKET_ARTWORK).remove([other]);

  const { publicUrl } = supabase.storage.from(STORAGE_BUCKET_ARTWORK).getPublicUrl(path).data;
  const replacedAt = new Date().toISOString();
  const artworkUrl = `${publicUrl}?v=${Date.parse(replacedAt)}`;

  let { error } = await supabase
    .from("releases")
    .update({ artwork_url: artworkUrl, artwork_replaced_at: replacedAt })
    .eq("id", row.id);
  if (error && /artwork_replaced_at/i.test(error.message)) {
    ({ error } = await supabase.from("releases").update({ artwork_url: artworkUrl }).eq("id", row.id));
  }
  if (error) {
    console.error("[admin/artwork] update:", error.message);
    return NextResponse.json({ ok: false, error: "Не удалось сохранить обложку." }, { status: 500 });
  }

  await invalidateMyReleasesCache(row as unknown as Record<string, unknown>);
  return NextResponse.json({ ok: true, artwork_url: artworkUrl, artwork_replaced_at: replacedAt });
}
