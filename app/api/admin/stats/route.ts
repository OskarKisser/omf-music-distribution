import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminSupabaseClient } from "@/lib/admin-release-api-guard";
import { getTelegramAuthContextFromRequest } from "@/lib/api/with-telegram-auth";
import type { AdminStatsResponse, AdminStuckRelease } from "@/types/admin";

/** Через сколько минут после создания незавершённый релиз считается застрявшим. */
const STUCK_AFTER_MIN = 30;

function stuckDupKey(telegramId: unknown, title: string | null | undefined): string {
  return `${String(telegramId ?? "").trim()}|${(title ?? "").trim().toLowerCase()}`;
}

function startOfUtcDayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function handleAdminStats(request: NextRequest): Promise<Response> {
  const guard = await requireAdminSupabaseClient(
    request,
    getTelegramAuthContextFromRequest(request)
  );
  if (!guard.ok) return guard.response;
  const supabase = guard.supabase;

  const dayStart = startOfUtcDayIso();

  const [{ count: pendingQueue, error: e1 }, { count: readyToday, error: e2 }] = await Promise.all([
    supabase
      .from("releases")
      .select("*", { count: "exact", head: true })
      .in("status", ["processing", "review"]),
    supabase
      .from("releases")
      .select("*", { count: "exact", head: true })
      .eq("status", "ready")
      .gte("created_at", dayStart)
  ]);

  if (e1) {
    console.error("[admin/stats] pending_queue:", e1.message);
    return NextResponse.json({ ok: false, error: "Failed to count queue" }, { status: 500 });
  }
  if (e2) {
    console.error("[admin/stats] ready_today:", e2.message);
    return NextResponse.json({ ok: false, error: "Failed to count ready today" }, { status: 500 });
  }

  // Расширенная статистика — best effort: ошибки не должны ломать счётчики очереди.
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let oldestWaitHours: number | null = null;
  let ready30 = 0;
  let failed30 = 0;
  const reasonCounts = new Map<string, number>();
  try {
    const [{ data: queueRows }, { count: r30 }, { data: failedRows }] = await Promise.all([
      supabase.from("releases").select("id").eq("status", "processing").limit(500),
      supabase
        .from("releases")
        .select("*", { count: "exact", head: true })
        .eq("status", "ready")
        .gte("created_at", since30),
      supabase
        .from("releases")
        .select("rejection_reasons")
        .eq("status", "failed")
        .gte("created_at", since30)
        .limit(1000)
    ]);
    ready30 = r30 ?? 0;
    failed30 = failedRows?.length ?? 0;
    for (const row of failedRows ?? []) {
      const keys = (row as { rejection_reasons?: string[] | null }).rejection_reasons ?? [];
      for (const k of keys) reasonCounts.set(k, (reasonCounts.get(k) ?? 0) + 1);
    }
    const ids = (queueRows ?? []).map((r) => (r as { id: string }).id);
    if (ids.length > 0) {
      const { data: logRows } = await supabase
        .from("release_logs")
        .select("created_at")
        .eq("stage", "finalize")
        .in("release_id", ids)
        .order("created_at", { ascending: true })
        .limit(1);
      const first = (logRows?.[0] as { created_at?: string } | undefined)?.created_at;
      if (first) {
        oldestWaitHours = Math.max(0, Math.round((Date.now() - new Date(first).getTime()) / 36e5));
      }
    }
  } catch (e) {
    console.error("[admin/stats] extended:", e instanceof Error ? e.message : e);
  }

  const funnel: { step: string; users: number }[] = [];
  try {
    const { data: ev } = await supabase
      .from("funnel_events")
      .select("anon_id, event, step")
      .gte("created_at", since30)
      .limit(20000);
    const buckets = new Map<string, Set<string>>();
    for (const r of ev ?? []) {
      const row = r as { anon_id: string; event: string; step: string | null };
      const k =
        row.event === "wizard_step_view" && row.step
          ? row.step
          : row.event === "submit_success"
            ? "submitted"
            : null;
      if (!k) continue;
      if (!buckets.has(k)) buckets.set(k, new Set());
      buckets.get(k)!.add(row.anon_id);
    }
    for (const step of ["metadata", "assets", "tracks", "review", "submitted"]) {
      funnel.push({ step, users: buckets.get(step)?.size ?? 0 });
    }
  } catch (e) {
    console.error("[admin/stats] funnel:", e instanceof Error ? e.message : e);
  }

  // Застряли до отправки: релиз начат, но финальный submit не нажат — в очередь модерации не попадает.
  const stuck: AdminStuckRelease[] = [];
  try {
    const stuckBefore = new Date(Date.now() - STUCK_AFTER_MIN * 60 * 1000).toISOString();
    const { data: stuckRows } = await supabase
      .from("releases")
      .select("id, title, track_name, artist_name, status, artwork_url, telegram_username, telegram_id, created_at, tracks(count)")
      .in("status", ["draft", "pending"])
      .lte("created_at", stuckBefore)
      .gte("created_at", since30)
      .order("created_at", { ascending: false })
      .limit(20);
    // Брошенный черновик-дубль: тот же артист потом отправил релиз с тем же названием.
    // Такой черновик не «застрял» — напоминать не о чем.
    const stuckTgIds = Array.from(
      new Set((stuckRows ?? []).map((r) => String((r as { telegram_id?: unknown }).telegram_id ?? "").trim()).filter(Boolean))
    );
    const submittedAt = new Map<string, string>();
    if (stuckTgIds.length > 0) {
      const { data: sentRows } = await supabase
        .from("releases")
        .select("telegram_id, title, track_name, created_at")
        .in("telegram_id", stuckTgIds)
        .not("status", "in", "(draft,pending)")
        .gte("created_at", since30)
        .limit(500);
      for (const s of sentRows ?? []) {
        const row = s as { telegram_id: unknown; title: string | null; track_name: string | null; created_at: string };
        const key = stuckDupKey(row.telegram_id, row.title || row.track_name);
        const prev = submittedAt.get(key);
        if (!prev || row.created_at > prev) submittedAt.set(key, row.created_at);
      }
    }
    for (const r of stuckRows ?? []) {
      const dup = r as { telegram_id?: unknown; title?: string | null; track_name?: string | null; created_at: string };
      const sentAt = submittedAt.get(stuckDupKey(dup.telegram_id, dup.title || dup.track_name));
      if (sentAt && new Date(sentAt).getTime() >= new Date(dup.created_at).getTime()) continue;
      const row = r as {
        id: string;
        title: string | null;
        track_name: string | null;
        artist_name: string | null;
        status: "draft" | "pending";
        artwork_url: string | null;
        telegram_username: string | null;
        telegram_id: string | number | null;
        created_at: string;
        tracks: { count: number }[] | null;
      };
      stuck.push({
        id: row.id,
        title: row.title?.trim() || row.track_name?.trim() || "Без названия",
        artist_name: row.artist_name?.trim() || "—",
        status: row.status,
        artwork_url: row.artwork_url,
        telegram_username: row.telegram_username,
        can_remind: /^\d+$/.test(String(row.telegram_id ?? "").trim()),
        created_at: row.created_at,
        tracks_count: row.tracks?.[0]?.count ?? 0
      });
    }
  } catch (e) {
    console.error("[admin/stats] stuck:", e instanceof Error ? e.message : e);
  }

  const body: AdminStatsResponse = {
    ok: true,
    pending_queue: pendingQueue ?? 0,
    ready_today: readyToday ?? 0,
    oldest_wait_hours: oldestWaitHours,
    ready_30d: ready30,
    failed_30d: failed30,
    funnel_30d: funnel,
    top_reject_reasons: Array.from(reasonCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key, count]) => ({ key, count })),
    stuck
  };

  return NextResponse.json(body);
}

export const GET = handleAdminStats;
