import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { refreshWidgets } from "@/lib/widgets/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function bearerMatches(request: NextRequest, secret: string | undefined): boolean {
  const s = secret?.trim();
  if (!s) return false;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${s}`);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

/**
 * Минутный цикл обновления карточек. На тарифе Hobby Vercel Cron — только раз в день,
 * поэтому вызывает pg_cron в Supabase (public.widgets_tick, секрет WIDGETS_TICK_SECRET).
 */
async function handle(request: NextRequest): Promise<Response> {
  if (!bearerMatches(request, process.env.WIDGETS_TICK_SECRET) && !bearerMatches(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 503 });
  const report = await refreshWidgets(admin);
  if (report.edited || report.removed || report.failed) console.log("[cron/widgets]", JSON.stringify(report));
  return NextResponse.json({ ok: true, ...report });
}

export const GET = handle;
export const POST = handle;
