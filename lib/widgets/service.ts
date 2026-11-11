/**
 * Отправка, учёт и обновление карточек.
 * В widget_messages — последняя карточка каждого вида в чате. Её обновляют:
 * сразу после событий (kickWidgets) и раз в минуту (/api/cron/widgets, вызывает pg_cron в Supabase).
 * Правим, только если данные действительно изменились: Telegram считает правку отправленным сообщением.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getExpectedAdminTelegramId } from "@/lib/admin";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { editMessageWidgetData, editWidgetCaption, isGoneError, isNotModifiedError, sendWidget } from "./api";
import { countNew24h, countUnpaid, loadArtistReleases, loadQueue } from "./data";
import { RELEASES_WIDGET_HTML, TODAY_WIDGET_HTML } from "./html.generated";
import { buildReleasesState, buildTodayState, type WidgetState } from "./state";

export type WidgetKind = "releases" | "today";

export type WidgetRecord = {
  chat_id: number | string;
  kind: WidgetKind;
  message_id: number;
  data_key: string;
  caption: string | null;
};

const TABLE = "widget_messages";
const DEFAULT_APP_URL = "https://t.me/omf_bot/app";

/** Ссылка на мини-приложение для кнопок карточки (только t.me — openTelegramLink). */
export function widgetAppUrl(): string {
  const raw = process.env.TELEGRAM_MINI_APP_URL?.trim().replace(/\/+$/, "") ?? "";
  return /^https:\/\/t\.me\/[A-Za-z0-9_]{4,64}(\/[A-Za-z0-9_]{1,64})?$/.test(raw) ? raw : DEFAULT_APP_URL;
}

export function widgetHtml(kind: WidgetKind): string {
  return (kind === "releases" ? RELEASES_WIDGET_HTML : TODAY_WIDGET_HTML).replace("%APP%", widgetAppUrl());
}

/** WIDGETS_ONLY — Telegram id через запятую для поэтапной выкатки; пусто — карточки всем. */
export function widgetsAllowed(telegramId: string | number | null | undefined): boolean {
  if (telegramId == null || !/^\d+$/.test(String(telegramId))) return false;
  const only = (process.env.WIDGETS_ONLY ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return only.length === 0 || only.includes(String(telegramId));
}

export function isAdminChat(chatId: string | number): boolean {
  try {
    return String(getExpectedAdminTelegramId()) === String(chatId);
  } catch {
    return false;
  }
}

export async function buildState(admin: SupabaseClient, kind: WidgetKind, chatId: string, now = new Date()): Promise<WidgetState> {
  if (kind === "releases") return buildReleasesState(await loadArtistReleases(admin, chatId, now), now);
  const [queue, unpaid, new24] = await Promise.all([loadQueue(admin, now), countUnpaid(admin), countNew24h(admin, now)]);
  return buildTodayState(queue, unpaid, new24, now);
}

async function remember(admin: SupabaseClient, rec: WidgetRecord): Promise<void> {
  const { error } = await admin
    .from(TABLE)
    .upsert({ ...rec, chat_id: String(rec.chat_id), updated_at: new Date().toISOString() }, { onConflict: "chat_id,kind" });
  if (error) console.error("[widgets] remember:", error.message);
}

async function forget(admin: SupabaseClient, chatId: string | number, kind: WidgetKind): Promise<void> {
  const { error } = await admin.from(TABLE).delete().eq("chat_id", String(chatId)).eq("kind", kind);
  if (error) console.error("[widgets] forget:", error.message);
}

export type SendResult = { ok: true; messageId: number } | { ok: false; reason: "not_allowed" | "not_admin" | "failed"; error?: string };

/**
 * Артисту без карточки «Мои релизы» — прислать её тихо (первое событие по релизу).
 * У кого карточка уже есть, её только обновляет refreshWidgets.
 */
export async function ensureReleasesCards(admin: SupabaseClient, chatIds: string[]): Promise<number> {
  const ids = chatIds.filter((id) => widgetsAllowed(id));
  if (!ids.length) return 0;
  const { data, error } = await admin.from(TABLE).select("chat_id").eq("kind", "releases").in("chat_id", ids);
  if (error) {
    console.error("[widgets] ensure:", error.message);
    return 0;
  }
  const have = new Set(((data ?? []) as { chat_id: unknown }[]).map((r) => String(r.chat_id)));
  let sent = 0;
  for (const id of ids) {
    if (have.has(id)) continue;
    const r = await sendWidgetCard(admin, "releases", id, { silent: true });
    if (r.ok) sent += 1;
  }
  return sent;
}

/** Отправить карточку и запомнить её как последнюю этого вида в чате. */
export async function sendWidgetCard(
  admin: SupabaseClient,
  kind: WidgetKind,
  chatId: string | number,
  opts: { silent?: boolean } = {}
): Promise<SendResult> {
  const id = String(chatId);
  if (!widgetsAllowed(id)) return { ok: false, reason: "not_allowed" };
  if (kind === "today" && !isAdminChat(id)) return { ok: false, reason: "not_admin" };
  try {
    const state = await buildState(admin, kind, id);
    const sent = await sendWidget({
      chatId: id,
      html: widgetHtml(kind),
      chatData: state.data,
      caption: state.caption,
      disableNotification: opts.silent
    });
    if (!sent.ok) {
      console.error(`[widgets] send ${kind} → ${id}:`, sent.error);
      return { ok: false, reason: "failed", error: sent.error };
    }
    await remember(admin, { chat_id: id, kind, message_id: sent.result.message_id, data_key: state.key, caption: state.caption });
    console.log(`[widgets] sent ${kind} → ${id} (message ${sent.result.message_id})`);
    return { ok: true, messageId: sent.result.message_id };
  } catch (e) {
    console.error(`[widgets] send ${kind} → ${id}:`, e);
    return { ok: false, reason: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

export type RefreshOutcome = "unchanged" | "edited" | "removed" | "failed";

/** Обновить одну карточку из учёта. Без изменений Telegram не трогаем. */
export async function refreshWidget(admin: SupabaseClient, rec: WidgetRecord, now = new Date()): Promise<RefreshOutcome> {
  const chatId = String(rec.chat_id);
  // Роль сняли (админ сменился) — эту карточку больше не обновляем.
  if (rec.kind === "today" && !isAdminChat(chatId)) {
    await forget(admin, chatId, rec.kind);
    return "removed";
  }
  try {
    const state = await buildState(admin, rec.kind, chatId, now);
    if (state.key === rec.data_key && state.caption === (rec.caption ?? "")) return "unchanged";
    if (state.key !== rec.data_key) {
      const r = await editMessageWidgetData({ chatId, messageId: rec.message_id, chatData: state.data });
      if (!r.ok && isGoneError(r.error, r.code)) {
        await forget(admin, chatId, rec.kind);
        return "removed";
      }
      if (!r.ok && !isNotModifiedError(r.error)) {
        console.warn(`[widgets] edit ${rec.kind} → ${chatId}:`, r.error);
        return "failed";
      }
    }
    if (state.caption !== (rec.caption ?? "")) {
      const c = await editWidgetCaption({ chatId, messageId: rec.message_id, caption: state.caption });
      if (!c.ok && !isNotModifiedError(c.error)) console.warn(`[widgets] caption ${rec.kind} → ${chatId}:`, c.error);
    }
    await remember(admin, { ...rec, chat_id: chatId, data_key: state.key, caption: state.caption });
    return "edited";
  } catch (e) {
    console.error(`[widgets] refresh ${rec.kind} → ${chatId}:`, e);
    return "failed";
  }
}

export type RefreshReport = Record<RefreshOutcome, number> & { total: number };

/** Обновить карточки из учёта (все или только указанных чатов/видов). */
export async function refreshWidgets(
  admin: SupabaseClient,
  filter: { chatIds?: string[]; kinds?: WidgetKind[] } = {},
  now = new Date()
): Promise<RefreshReport> {
  const report: RefreshReport = { total: 0, unchanged: 0, edited: 0, removed: 0, failed: 0 };
  let q = admin.from(TABLE).select("chat_id, kind, message_id, data_key, caption").limit(1000);
  if (filter.chatIds?.length) q = q.in("chat_id", filter.chatIds);
  if (filter.kinds?.length) q = q.in("kind", filter.kinds);
  const { data, error } = await q;
  if (error) {
    console.error("[widgets] load records:", error.message);
    return report;
  }
  const records = (data ?? []) as WidgetRecord[];
  report.total = records.length;
  // По 5 параллельно: укладываемся во время функции и не упираемся в лимиты Telegram.
  for (let i = 0; i < records.length; i += 5) {
    const outs = await Promise.all(records.slice(i, i + 5).map((r) => refreshWidget(admin, r, now)));
    for (const o of outs) report[o] += 1;
  }
  return report;
}

const KICK_TIMEOUT_MS = 4000;

/**
 * Сразу после события: обновить пульт админа и «Мои релизы» затронутых артистов.
 * Не бросает и не держит основной сценарий дольше нескольких секунд — остальное догонит минутный цикл.
 */
export async function kickWidgets(
  artistTelegramIds: Array<string | number | null | undefined> = [],
  opts: { ensureCard?: boolean } = {}
): Promise<void> {
  const admin = createSupabaseAdmin();
  if (!admin || !process.env.TELEGRAM_BOT_TOKEN?.trim()) return;
  const ids = artistTelegramIds.map((x) => (x == null ? "" : String(x).trim())).filter((x) => /^\d+$/.test(x));
  const work = (async () => {
    try {
      await refreshWidgets(admin, { kinds: ["today"] });
      if (ids.length) await refreshWidgets(admin, { kinds: ["releases"], chatIds: ids });
      if (ids.length && opts.ensureCard) await ensureReleasesCards(admin, ids);
    } catch (e) {
      console.error("[widgets] kick:", e);
    }
  })();
  await Promise.race([work, new Promise((r) => setTimeout(r, KICK_TIMEOUT_MS))]);
}
