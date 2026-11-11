import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getExpectedAdminTelegramId } from "@/lib/admin";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { callBotApiResult } from "@/lib/telegram-bot.server";
import { setMyCommands } from "@/lib/widgets/api";
import { runBroadcast } from "@/lib/widgets/broadcast";
import { sendWidgetCard } from "@/lib/widgets/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Служебная настройка карточек на проде (токен бота есть только в окружении Vercel).
 * Доступ — Bearer WIDGETS_TICK_SECRET. Действия:
 *   info — куда смотрит вебхук и сколько карточек в учёте;
 *   setup — вебхук получает message и widget_query, меню команд админу;
 *   test — пульт и «Мои релизы» админу;
 *   commands_all — /releases в меню всем в личке (общая выкатка);
 *   broadcast — рассылка роли, по умолчанию сухой прогон.
 */
const bodySchema = z.object({
  action: z.enum(["info", "setup", "test", "commands_all", "broadcast"]),
  role: z.enum(["admin", "artists"]).optional(),
  dryRun: z.boolean().optional()
});

const ADMIN_COMMANDS = [
  { command: "today", description: "Пульт: очередь и оплаты" },
  { command: "releases", description: "Мои релизы — живая карточка" }
];
const ARTIST_COMMANDS = [{ command: "releases", description: "Мои релизы — живая карточка" }];
const WEBHOOK_UPDATES = ["callback_query", "message", "widget_query"];

type WebhookInfo = { url?: string; allowed_updates?: string[]; pending_update_count?: number; last_error_message?: string };

function authorized(request: NextRequest): boolean {
  const s = process.env.WIDGETS_TICK_SECRET?.trim();
  if (!s) return false;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${s}`);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Bad body" }, { status: 400 });
  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 503 });
  const adminId = String(getExpectedAdminTelegramId());
  const { action } = parsed.data;

  const info = async () => {
    const r = await callBotApiResult<WebhookInfo>("getWebhookInfo", {});
    const { count } = await admin.from("widget_messages").select("chat_id", { count: "exact", head: true });
    return r.ok
      ? {
          url: r.result.url,
          allowed_updates: r.result.allowed_updates,
          pending: r.result.pending_update_count,
          last_error: r.result.last_error_message ?? null,
          widget_messages: count ?? 0
        }
      : { error: r.error };
  };

  if (action === "info") return NextResponse.json({ ok: true, ...(await info()) });

  if (action === "setup") {
    const before = await callBotApiResult<WebhookInfo>("getWebhookInfo", {});
    const url = before.ok ? before.result.url ?? "" : "";
    // Меняем только список апдейтов у нашего же вебхука — чужой адрес не трогаем.
    if (!/^https:\/\/[^/]+\/api\/telegram\/webhook$/.test(url)) {
      return NextResponse.json({ ok: false, error: `unexpected webhook url: ${url || "none"}` }, { status: 409 });
    }
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (!secret) return NextResponse.json({ ok: false, error: "TELEGRAM_WEBHOOK_SECRET is not set" }, { status: 503 });
    const hook = await callBotApiResult("setWebhook", { url, secret_token: secret, allowed_updates: WEBHOOK_UPDATES });
    const cmds = await setMyCommands(ADMIN_COMMANDS, { type: "chat", chat_id: adminId });
    return NextResponse.json({
      ok: hook.ok && cmds.ok,
      webhook: hook.ok ? "ok" : hook.error,
      commands: cmds.ok ? "ok" : cmds.error,
      ...(await info())
    });
  }

  if (action === "test") {
    const today = await sendWidgetCard(admin, "today", adminId);
    const releases = await sendWidgetCard(admin, "releases", adminId);
    return NextResponse.json({ ok: today.ok && releases.ok, today, releases });
  }

  if (action === "commands_all") {
    const r = await setMyCommands(ARTIST_COMMANDS, { type: "all_private_chats" });
    return NextResponse.json({ ok: r.ok, error: r.ok ? undefined : r.error });
  }

  const role = parsed.data.role ?? "admin";
  const report = await runBroadcast(admin, role, parsed.data.dryRun !== false);
  return NextResponse.json({ ok: true, ...report });
}
