import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminSupabaseClient } from "@/lib/admin-release-api-guard";
import { getTelegramAuthContextFromRequest } from "@/lib/api/with-telegram-auth";
import { invalidateMyReleasesCache } from "@/lib/server/release-list-cache";
import { notifyArtist } from "@/lib/server/artist-notify";
import {
  PLATFORM_ISSUE_PLATFORM_KEYS,
  PLATFORM_ISSUE_REASON_KEYS,
  platformIssueMessage,
  platformIssueResolvedMessage
} from "@/lib/platform-issue";
import { getReleaseDisplayTitle, type ReleaseRecord } from "@/repositories/releases.repo";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ releaseId: z.string().uuid() });

const markSchema = z.object({
  platforms: z.array(z.enum(PLATFORM_ISSUE_PLATFORM_KEYS)).min(1).max(PLATFORM_ISSUE_PLATFORM_KEYS.length),
  reasons: z.array(z.enum(PLATFORM_ISSUE_REASON_KEYS)).max(PLATFORM_ISSUE_REASON_KEYS.length).default([]),
  note: z.string().trim().max(1000).optional().default(""),
  notify: z.boolean().optional().default(true)
});

const resolveSchema = z.object({ notify: z.boolean().optional().default(true) });

const SELECT = "id, status, title, track_name, telegram_id, user_uuid, user_id, platform_issue_at";

type AdminSupabase = Extract<Awaited<ReturnType<typeof requireAdminSupabaseClient>>, { ok: true }>["supabase"];

type Loaded = { ok: true; supabase: AdminSupabase; row: ReleaseRecord } | { ok: false; response: Response };

async function loadRelease(request: NextRequest, params: { releaseId: string }): Promise<Loaded> {
  const guard = await requireAdminSupabaseClient(request, getTelegramAuthContextFromRequest(request));
  if (!guard.ok) return { ok: false, response: guard.response };

  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Некорректный ID релиза." }, { status: 400 }) };
  }

  const { data, error } = await guard.supabase.from("releases").select(SELECT).eq("id", parsed.data.releaseId).maybeSingle();
  if (error) {
    console.error("[admin/platform-issue] load:", error.message);
    const missing = error.message.includes("platform_issue");
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: missing ? "Нужна миграция release_platform_issue в базе." : "Не удалось загрузить релиз." },
        { status: 500 }
      )
    };
  }
  if (!data) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Релиз не найден." }, { status: 404 }) };
  }
  return { ok: true, supabase: guard.supabase, row: data as unknown as ReleaseRecord };
}

async function readBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/** Площадка сняла вышедший релиз: отмечаем, артист видит «Обновляем на площадках», бот пишет ему. */
export async function POST(
  request: NextRequest,
  routeContext: { params: { releaseId: string } }
): Promise<Response> {
  const loaded = await loadRelease(request, routeContext.params);
  if (!loaded.ok) return loaded.response;
  const { row } = loaded;

  if (row.status !== "ready") {
    return NextResponse.json({ ok: false, error: "Отметить можно только вышедший релиз." }, { status: 409 });
  }

  const body = markSchema.safeParse(await readBody(request));
  if (!body.success) {
    return NextResponse.json({ ok: false, error: "Выбери хотя бы одну площадку." }, { status: 400 });
  }
  const { platforms, reasons, note, notify } = body.data;
  const at = row.platform_issue_at ?? new Date().toISOString();

  const { error } = await loaded.supabase
    .from("releases")
    .update({
      platform_issue_platforms: platforms,
      platform_issue_reasons: reasons,
      platform_issue_note: note || null,
      platform_issue_at: at
    })
    .eq("id", row.id);
  if (error) {
    console.error("[admin/platform-issue] mark:", error.message);
    return NextResponse.json({ ok: false, error: "Не удалось сохранить." }, { status: 500 });
  }

  await invalidateMyReleasesCache(row as unknown as Record<string, unknown>);
  if (notify) {
    await notifyArtist(row, platformIssueMessage(getReleaseDisplayTitle(row), { platforms, reasons }));
  }
  return NextResponse.json({ ok: true, platform_issue_at: at, notified: notify });
}

/** Релиз вернулся на площадки: снимаем отметку, бот пишет артисту. */
export async function DELETE(
  request: NextRequest,
  routeContext: { params: { releaseId: string } }
): Promise<Response> {
  const loaded = await loadRelease(request, routeContext.params);
  if (!loaded.ok) return loaded.response;
  const { row } = loaded;

  if (!row.platform_issue_at) {
    return NextResponse.json({ ok: true, alreadyResolved: true });
  }
  const parsedBody = resolveSchema.safeParse(await readBody(request));
  const notify = parsedBody.success ? parsedBody.data.notify : true;
  const resolvedAt = new Date().toISOString();

  const { error } = await loaded.supabase
    .from("releases")
    .update({
      platform_issue_platforms: null,
      platform_issue_reasons: null,
      platform_issue_note: null,
      platform_issue_at: null,
      platform_issue_resolved_at: resolvedAt
    })
    .eq("id", row.id);
  if (error) {
    console.error("[admin/platform-issue] resolve:", error.message);
    return NextResponse.json({ ok: false, error: "Не удалось сохранить." }, { status: 500 });
  }

  await invalidateMyReleasesCache(row as unknown as Record<string, unknown>);
  if (notify) {
    await notifyArtist(row, platformIssueResolvedMessage(getReleaseDisplayTitle(row)));
  }
  return NextResponse.json({ ok: true, platform_issue_resolved_at: resolvedAt });
}
