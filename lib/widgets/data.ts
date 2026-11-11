/**
 * Данные для карточек из базы (service role). Права здесь не проверяются — это делает queries.ts / service.ts:
 * артист получает только свои релизы (по Telegram id), пульт — только админ.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { readPlatformIssue } from "@/lib/platform-issue";
import { releaseTypeLabel } from "@/lib/release-type-label";
import { loadSubmittedAt } from "@/lib/server/release-submitted-at";
import { getReleaseReferral } from "@/lib/server/referrals";
import { getReleaseDisplayTitle } from "@/repositories/releases/types";
import { PAGE_SIZE, releaseItem, type ArtistRelease, type PaymentItem, type QueueItem, type ReleaseItem } from "./state";

const ARTIST_SELECT =
  "id, title, track_name, artist_name, release_type, status, smart_link, release_date, created_at, " +
  "platform_issue_platforms, platform_issue_reasons, platform_issue_note, platform_issue_at";
const ARTIST_SELECT_LEGACY = "id, title, track_name, artist_name, release_type, status, smart_link, release_date, created_at";

type Row = Record<string, unknown>;

/** Фильтр владельца, как в /api/releases/my: legacy user_id, telegram_id и привязанные профили. */
async function ownerFilter(admin: SupabaseClient, telegramId: string): Promise<string> {
  const parts = [`user_id.eq.${telegramId}`, `telegram_id.eq.${telegramId}`];
  const { data } = await admin.from("users").select("id").eq("telegram_id", telegramId).limit(10);
  const uuids = ((data ?? []) as Row[]).map((p) => p.id).filter((id): id is string => typeof id === "string");
  if (uuids.length) parts.push(`user_uuid.in.(${uuids.join(",")})`);
  return parts.join(",");
}

export async function loadArtistReleases(admin: SupabaseClient, telegramId: string, now: Date): Promise<ReleaseItem[]> {
  if (!/^\d+$/.test(telegramId)) return [];
  const filter = await ownerFilter(admin, telegramId);
  const run = (select: string) =>
    admin.from("releases").select(select).or(filter).order("created_at", { ascending: false }).limit(200);
  let { data, error } = await run(ARTIST_SELECT);
  if (error && /platform_issue/i.test(error.message ?? "")) ({ data, error } = await run(ARTIST_SELECT_LEGACY));
  if (error) throw new Error(`widgets artist releases: ${error.message}`);
  const rows = (data ?? []) as unknown as Row[];
  const processing = rows.filter((r) => r.status === "processing").map((r) => String(r.id));
  const submitted = await loadSubmittedAt(admin, processing);
  return rows.map((r) => {
    const rel: ArtistRelease = {
      id: String(r.id),
      title: getReleaseDisplayTitle(r as { title?: string | null; track_name?: string | null }),
      artist: String(r.artist_name ?? "").trim(),
      type: releaseTypeLabel(r.release_type) ?? "Релиз",
      status: typeof r.status === "string" ? r.status : null,
      smartLink: typeof r.smart_link === "string" ? r.smart_link : null,
      releaseDate: typeof r.release_date === "string" ? r.release_date : null,
      submittedAt: submitted.get(String(r.id)) ?? null,
      platformIssue: readPlatformIssue(r as Parameters<typeof readPlatformIssue>[0])
    };
    return releaseItem(rel, now);
  });
}

/** Очередь модерации: отправленные релизы и сколько ждут (с момента отправки, иначе с создания). */
export async function loadQueue(admin: SupabaseClient, now: Date): Promise<QueueItem[]> {
  const { data, error } = await admin
    .from("releases")
    .select("id, title, track_name, artist_name, created_at")
    .in("status", ["processing", "review"])
    .order("created_at", { ascending: true })
    .limit(300);
  if (error) throw new Error(`widgets queue: ${error.message}`);
  const rows = (data ?? []) as unknown as Row[];
  const submitted = await loadSubmittedAt(admin, rows.map((r) => String(r.id)));
  return rows.map((r) => {
    const at = submitted.get(String(r.id)) ?? String(r.created_at ?? "");
    const t = new Date(at).getTime();
    return {
      id: String(r.id),
      title: getReleaseDisplayTitle(r as { title?: string | null; track_name?: string | null }),
      artist: String(r.artist_name ?? "").trim(),
      waitMin: Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now.getTime() - t) / 60000))
    };
  });
}

/** «Оплата не отмечена» — бот спросил «Оплатил?» (awaiting), а ответа ещё нет. */
export async function countUnpaid(admin: SupabaseClient): Promise<number> {
  const { count, error } = await admin
    .from("releases")
    .select("id", { count: "exact", head: true })
    .eq("payment_status", "awaiting");
  if (error) throw new Error(`widgets unpaid: ${error.message}`);
  return count ?? 0;
}

/** Сколько релизов отправили на проверку за сутки (по журналу finalize). */
export async function countNew24h(admin: SupabaseClient, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 36e5).toISOString();
  const { data, error } = await admin
    .from("release_logs")
    .select("release_id")
    .eq("stage", "finalize")
    .gte("created_at", since)
    .limit(1000);
  if (error) throw new Error(`widgets new24h: ${error.message}`);
  return new Set(((data ?? []) as Row[]).map((r) => r.release_id).filter(Boolean)).size;
}

export async function loadPaymentPage(
  admin: SupabaseClient,
  off: number
): Promise<{ items: PaymentItem[]; total: number }> {
  const from = Math.max(0, off);
  const { data, error, count } = await admin
    .from("releases")
    .select("id, title, track_name, artist_name, telegram_id, payment_status", { count: "exact" })
    .eq("payment_status", "awaiting")
    .order("created_at", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(`widgets payments: ${error.message}`);
  const rows = (data ?? []) as unknown as Row[];
  const items = await Promise.all(
    rows.map(async (r) => {
      let discountRub = 0;
      try {
        const ref = await getReleaseReferral(admin, {
          id: String(r.id),
          telegram_id: r.telegram_id,
          payment_status: (r.payment_status as string | null) ?? null
        });
        discountRub = ref?.discountRub ?? 0;
      } catch {
        // скидку не показали — не страшно, в «Оплатил?» она есть
      }
      return {
        id: String(r.id),
        title: getReleaseDisplayTitle(r as { title?: string | null; track_name?: string | null }),
        artist: String(r.artist_name ?? "").trim(),
        discountRub
      };
    })
  );
  return { items, total: count ?? items.length };
}
