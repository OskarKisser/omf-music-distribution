import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TelegramAuthContext } from "@/lib/api/with-telegram-auth";
import { getExpectedAdminTelegramId, telegramIdsEqual } from "@/lib/admin";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { verifyAdminDownloadUrl } from "@/lib/admin-download-token";
import { createClient } from "@supabase/supabase-js";
import { supabaseNoStoreFetch } from "@/lib/supabase-no-store-fetch";

export type AdminGuardResult =
  | { ok: true; supabase: SupabaseClient }
  | { ok: false; response: Response };

/**
 * Проверка Telegram admin + service role клиент для админ-API релизов.
 */
async function isWebAdminRequest(request: NextRequest, supabase: SupabaseClient): Promise<boolean> {
  const authHeader = request.headers.get("authorization") ?? request.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!token) return false;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!url || !anon) return false;

  const anonClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: supabaseNoStoreFetch }
  });
  const {
    data: { user },
    error: authError
  } = await anonClient.auth.getUser(token);
  if (authError || !user?.id) return false;

  const { data: row, error } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !row) return false;
  return String((row as { role?: string | null }).role ?? "").trim().toLowerCase() === "admin";
}

export async function requireAdminSupabaseClient(
  request: NextRequest,
  ctx: TelegramAuthContext | null
): Promise<AdminGuardResult> {
  let adminId: number;
  try {
    adminId = getExpectedAdminTelegramId();
  } catch (e) {
    console.error("[admin-release-api]", e);
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 503 })
    };
  }

  const supabase = createSupabaseAdmin();
  if (!supabase) {
    console.error("[admin-release-api] missing Supabase service role");
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 503 })
    };
  }

  const telegramAllowed = ctx ? telegramIdsEqual(ctx.user.id, adminId) : false;
  // Подписанная ссылка на скачивание (GET, выдаётся только админу через /api/admin/download-link).
  const signedDownload = request.method === "GET" && verifyAdminDownloadUrl(request.url);
  if (!telegramAllowed && !signedDownload) {
    const webAllowed = await isWebAdminRequest(request, supabase);
    if (!webAllowed) {
      return {
        ok: false,
        response: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
      };
    }
  }

  return { ok: true, supabase };
}
