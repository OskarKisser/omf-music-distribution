import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "crypto";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { congratulateReleaseDay, remindUnfinishedDrafts } from "@/lib/server/daily-bot-jobs";
import { getExpectedAdminTelegramId } from "@/lib/admin";
import { sendWidgetCard } from "@/lib/widgets/service";
import { sendWeeklyWidgetSummary } from "@/lib/widgets/summary";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Vercel Cron присылает `Authorization: Bearer $CRON_SECRET`. */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

/** Ежедневно в 10:00 по Москве (см. vercel.json): напоминания о черновиках, поздравления с выходом, утренний пульт админу, по понедельникам — сводка по карточкам. */
export async function GET(request: NextRequest): Promise<Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const admin = createSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 503 });
  }

  const now = new Date();
  // Задачи независимы: сбой одной не отменяет другую.
  const [drafts, releaseDay, today, summary] = await Promise.allSettled([
    remindUnfinishedDrafts(admin, now),
    congratulateReleaseDay(admin, now),
    sendWidgetCard(admin, "today", String(getExpectedAdminTelegramId())),
    sendWeeklyWidgetSummary(admin, now)
  ]);
  const report = (r: PromiseSettledResult<unknown>) =>
    r.status === "fulfilled" ? r.value : { error: r.reason instanceof Error ? r.reason.message : String(r.reason) };
  const body = { ok: true, drafts: report(drafts), releaseDay: report(releaseDay), today: report(today), widgetsSummary: report(summary) };
  console.log("[cron/daily]", JSON.stringify(body));
  return NextResponse.json(body);
}
