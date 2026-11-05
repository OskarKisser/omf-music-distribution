import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { resolveReleaseActor } from "@/lib/api/resolve-submit-actor";
import type { ReleaseRecord } from "@/repositories/releases.repo";
import { getJsonCache, setJsonCache } from "@/lib/server/redis-cache";
import { isMissingReleasesColumnError } from "@/lib/errors";
import { loadSubmittedAt } from "@/lib/server/release-submitted-at";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RELEASE_LIST_SELECT = [
  "id",
  "title",
  "track_name",
  "artist_name",
  "artwork_url",
  "status",
  "created_at",
  "error_message",
  "admin_notes",
  "draft_upload_started",
  "isrc",
  "upc",
  "release_type",
  "smart_link",
  "release_date"
].join(",");
/** `rejection_reasons` — из миграции 20261012190000; без неё список грузится по базовому набору. */
const RELEASE_LIST_SELECT_WITH_REASONS = `${RELEASE_LIST_SELECT},rejection_reasons`;
/** Площадка сняла релиз — миграция 20261105180000; без неё откатываемся на набор выше. */
const RELEASE_LIST_SELECT_FULL = `${RELEASE_LIST_SELECT_WITH_REASONS},platform_issue_platforms,platform_issue_at`;
const RELEASES_CACHE_TTL_SECONDS = 20;
type ReleaseListRow = ReleaseListBaseRow & {
  /** Когда ушёл на проверку (последний finalize), только для `processing`. */
  submitted_at?: string | null;
};
type ReleaseListBaseRow = Pick<
  ReleaseRecord,
  | "id"
  | "title"
  | "track_name"
  | "artist_name"
  | "artwork_url"
  | "status"
  | "created_at"
  | "error_message"
  | "admin_notes"
  | "draft_upload_started"
  | "isrc"
  | "upc"
  | "release_type"
  | "smart_link"
  | "release_date"
  | "rejection_reasons"
  | "platform_issue_platforms"
  | "platform_issue_at"
>;

async function handleGetMyReleases(request: NextRequest): Promise<Response> {
  const actor = await resolveReleaseActor(request);
  const cacheScope =
    actor?.kind === "telegram"
      ? `tg:${actor.telegramUserId}`
      : actor?.kind === "web"
        ? `web:${actor.authUserId}`
        : null;
  const cacheKey = cacheScope ? `releases:my:${cacheScope}` : null;

  if (cacheKey) {
    const cachedRows = await getJsonCache<ReleaseListRow[]>(cacheKey);
    if (Array.isArray(cachedRows)) {
      return NextResponse.json({ ok: true, rows: cachedRows, cached: true });
    }
  }

  if (!actor) {
    // Dev-only: в production голому заголовку доверять нельзя (IDOR через service role).
    const rawUid = process.env.NODE_ENV !== "production" ? request.headers.get("x-telegram-user-id") : null;
    const fallbackUid = rawUid ? Math.trunc(Number(rawUid)) : null;

    if (fallbackUid && Number.isFinite(fallbackUid) && fallbackUid > 0) {
      // Treat as telegram actor with just the userId
      const admin = createSupabaseAdmin();
      if (admin) {
        const tid = String(fallbackUid);
        const { data } = await admin
          .from("releases")
          .select(RELEASE_LIST_SELECT)
          .or(`user_id.eq.${tid},telegram_id.eq.${tid}`)
          .order("created_at", { ascending: false });
        const rows = (data ?? []) as unknown as ReleaseListRow[];
        await setJsonCache(`releases:my:tg:${tid}`, rows, RELEASES_CACHE_TTL_SECONDS);
        return NextResponse.json({ ok: true, rows });
      }
    }

    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 503 }
    );
  }

  // Telegram: legacy user_id / telegram_id + привязанные профили; веб: только user_uuid.
  let ownerFilter = `user_uuid.eq.${actor.kind === "web" ? actor.authUserId : ""}`;
  if (actor.kind === "telegram") {
    const tid = String(actor.telegramUserId);
    const { data: profiles } = await admin
      .from("users")
      .select("id")
      .eq("telegram_id", tid)
      .limit(10);
    const profileUuids = Array.isArray(profiles)
      ? profiles
          .map((p) => (typeof (p as { id?: unknown }).id === "string" ? (p as { id: string }).id : null))
          .filter((id): id is string => id != null)
      : [];
    const orParts = [`user_id.eq.${tid}`, `telegram_id.eq.${tid}`];
    if (profileUuids.length > 0) {
      // Support multi-linked/legacy rows: include all matching profile UUIDs.
      orParts.push(`user_uuid.in.(${profileUuids.join(",")})`);
    }
    ownerFilter = orParts.join(",");
  }

  const runQuery = (select: string) => {
    return admin.from("releases").select(select).or(ownerFilter).order("created_at", { ascending: false });
  };

  let { data, error } = await runQuery(RELEASE_LIST_SELECT_FULL);
  if (error && /platform_issue/i.test(error.message ?? "")) {
    ({ data, error } = await runQuery(RELEASE_LIST_SELECT_WITH_REASONS));
  }
  if (error && isMissingReleasesColumnError(error, "rejection_reasons")) {
    ({ data, error } = await runQuery(RELEASE_LIST_SELECT));
  }
  if (error) {
    console.error("[releases/my] fetch:", error.message);
    return NextResponse.json({ ok: false, error: "Не удалось загрузить релизы." }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as ReleaseListRow[];
  const processingIds = rows.filter((r) => r.status === "processing").map((r) => r.id);
  if (processingIds.length > 0) {
    const submitted = await loadSubmittedAt(admin, processingIds);
    for (const r of rows) {
      const at = submitted.get(r.id);
      if (at) r.submitted_at = at;
    }
  }
  if (cacheKey) {
    await setJsonCache(cacheKey, rows, RELEASES_CACHE_TTL_SECONDS);
  }
  return NextResponse.json({ ok: true, rows });
}

export const GET = handleGetMyReleases;

