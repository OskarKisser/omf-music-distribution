import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import type { TelegramAuthContext } from "@/lib/api/with-telegram-auth";
import { withTelegramAuth } from "@/lib/api/with-telegram-auth";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { getUserProfileByTelegramId } from "@/lib/auth/hybrid-auth";

export type UserPreferences = {
  user_uuid: string;
  /** Решение модератора и другие события по релизу. */
  push_notifications: boolean;
  notify_draft_reminder: boolean;
  notify_release_day: boolean;
  updated_at: string;
};

/** Строка из БД → настройки; до миграции новых колонок там нет — считаем включёнными. */
function toPreferences(row: Record<string, unknown>, userUuid: string): UserPreferences {
  return {
    user_uuid: userUuid,
    push_notifications: row.push_notifications !== false,
    notify_draft_reminder: row.notify_draft_reminder !== false,
    notify_release_day: row.notify_release_day !== false,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString()
  };
}

// ─── GET ─────────────────────────────────────────────────────────────────────

async function handleGetPreferences(
  _request: NextRequest,
  ctx: TelegramAuthContext
): Promise<Response> {
  const admin = createSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 500 });
  }

  // Get user UUID from Telegram ID
  const userProfile = await getUserProfileByTelegramId(BigInt(ctx.user.id));
  if (!userProfile) {
    return NextResponse.json({ ok: false, error: "User profile not found" }, { status: 404 });
  }

  const { data, error } = await admin
    .from("user_preferences")
    .select("*")
    .eq("user_uuid", userProfile.id)
    .maybeSingle();

  if (error) {
    console.error("[settings/preferences GET]", error.message);
    return NextResponse.json({ ok: false, error: "Не удалось загрузить настройки." }, { status: 500 });
  }

  // Строки ещё нет — всё включено по умолчанию.
  return NextResponse.json({ ok: true, preferences: toPreferences(data ?? {}, userProfile.id) });
}

export const GET = withTelegramAuth(handleGetPreferences);

// ─── POST (upsert) ────────────────────────────────────────────────────────────

const upsertSchema = z.object({
  push_notifications: z.boolean().optional(),
  notify_draft_reminder: z.boolean().optional(),
  notify_release_day: z.boolean().optional()
});

async function handlePostPreferences(
  request: NextRequest,
  ctx: TelegramAuthContext
): Promise<Response> {
  const admin = createSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 500 });
  }

  // Get user UUID from Telegram ID
  const userProfile = await getUserProfileByTelegramId(BigInt(ctx.user.id));
  if (!userProfile) {
    return NextResponse.json({ ok: false, error: "User profile not found" }, { status: 404 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Неверный формат тела запроса." }, { status: 400 });
  }

  const parsed = upsertSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Некорректные данные.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const payload = {
    user_uuid: userProfile.id,
    ...parsed.data
  };

  const { data, error } = await admin
    .from("user_preferences")
    .upsert(payload, { onConflict: "user_uuid" })
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[settings/preferences POST]", error.message);
    return NextResponse.json({ ok: false, error: "Не удалось сохранить настройки." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, preferences: toPreferences(data ?? payload, userProfile.id) });
}

export const POST = withTelegramAuth(handlePostPreferences);
