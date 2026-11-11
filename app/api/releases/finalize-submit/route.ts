import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { resolveReleaseActor } from "@/lib/api/resolve-submit-actor";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import {
  isReleaseActorOwner,
  numericUserIdForReleaseAiLogs,
  type ReleaseActor
} from "@/lib/release-ownership.server";
import { formatErrorMessage } from "@/lib/errors";
import { escapeHtml } from "@/lib/telegram-bot.server";
import { notifyAdminReleaseSubmitted } from "@/lib/admin-notify.server";
import { artistTelegramId, notifyArtist } from "@/lib/server/artist-notify";
import { sendWidgetCard } from "@/lib/widgets/service";
import { invalidateMyReleasesCache } from "@/lib/server/release-list-cache";
import { getReleaseDisplayTitle, type ReleaseRecord } from "@/repositories/releases.repo";
import { runAiMetadataPrecheckForRelease } from "@/lib/release-ai-moderation.server";
import { requestPaymentConfirmationOnSubmit } from "@/lib/server/payment-confirm";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Уведомление в Telegram только если у релиза есть реальный `telegram_id` (не веб-only). */
async function notifyReleaseSubmittedForModeration(
  admin: SupabaseClient,
  record: ReleaseRecord,
  appOrigin: string
): Promise<void> {
  await invalidateMyReleasesCache(record as Record<string, unknown>);
  await notifyAdminReleaseSubmitted({
    releaseId: record.id,
    title: getReleaseDisplayTitle(record),
    artist: String(record.artist_name ?? ""),
    telegramId: record.telegram_id,
    appOrigin
  });
  const rawTitle = getReleaseDisplayTitle(record);
  const title = escapeHtml(rawTitle.length > 0 ? rawTitle : "релиз");
  const text =
    `🚀 <b>Ваш релиз «${title}» отправлен на модерацию!</b>\n\n` +
    `Мы проверим его в течение 24 часов и пришлем уведомление здесь.`;
  await notifyArtist(record, text);
  // Карточка «Мои релизы» — живой статус рядом с текстом; текст остаётся для компьютера и уведомлений.
  const tid = artistTelegramId(record);
  if (tid) await sendWidgetCard(admin, "releases", tid, { silent: true });
  // Вопрос студии об оплате — вспомогательный: его сбой не должен ломать отправку релиза.
  try {
    await requestPaymentConfirmationOnSubmit(admin, record);
  } catch (e) {
    console.error("[finalize-submit] payment request:", e);
  }
}

const bodySchema = z.object({
  releaseId: z.string().uuid(),
  clientRequestId: z.string().uuid(),
  /**
   * Артист отметил условия (платный выпуск, без возвратов) на шаге «Проверка».
   * Галочку требует интерфейс; сервер только записывает время. Без поля (открытая во время
   * деплоя старая версия приложения) релиз всё равно уходит — отправку не блокируем.
   */
  termsAccepted: z.boolean().optional()
});

/** PostgREST для `RETURNS SETOF releases` отдаёт полную строку; кастомный `RETURNS jsonb` — нет (ломает клиент). */
const RELEASE_ROW_STATUSES = new Set([
  "draft",
  "pending",
  "processing",
  "ready",
  "failed",
  "review"
]);

function looksLikeReleaseTableRow(x: unknown): x is ReleaseRecord {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length < 32) return false;
  return typeof o.status === "string" && RELEASE_ROW_STATUSES.has(o.status);
}

async function handleFinalizeSubmit(request: NextRequest, actor: ReleaseActor): Promise<Response> {
  const admin = createSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 503 }
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Некорректное тело запроса." }, { status: 400 });
  }

  const { releaseId, clientRequestId, termsAccepted } = parsed.data;

  const { data: currentRow, error: loadErr } = await admin
    .from("releases")
    .select("*")
    .eq("id", releaseId)
    .maybeSingle();

  if (loadErr) {
    console.error("[finalize-submit] load:", loadErr.message);
    return NextResponse.json({ ok: false, error: "Не удалось загрузить релиз." }, { status: 500 });
  }

  if (!currentRow) {
    return NextResponse.json({ ok: false, error: "Релиз не найден." }, { status: 404 });
  }

  const rowObj = currentRow as Record<string, unknown>;
  if (!(await isReleaseActorOwner(admin, rowObj, actor))) {
    return NextResponse.json({ ok: false, error: "Нет доступа к этому релизу." }, { status: 403 });
  }

  if (currentRow.client_request_id !== clientRequestId) {
    return NextResponse.json(
      { ok: false, error: "Идентификатор запроса не совпадает с релизом." },
      { status: 400 }
    );
  }

  const current = currentRow as ReleaseRecord;
  if (current.status === "processing" || current.status === "ready") {
    return NextResponse.json({ ok: true, record: current });
  }

  if (termsAccepted === true) {
    const { error: termsErr } = await admin
      .from("releases")
      .update({ terms_accepted_at: new Date().toISOString() })
      .eq("id", releaseId);
    if (termsErr) {
      console.error("[finalize-submit] terms_accepted_at:", termsErr.message);
    }
  } else {
    console.warn("[finalize-submit] submit without termsAccepted (old app version?)", releaseId);
  }

  const aiUserId = numericUserIdForReleaseAiLogs(actor, rowObj);
  const aiGate = await runAiMetadataPrecheckForRelease(admin, releaseId, aiUserId);
  if (!aiGate.allow) {
    if (aiGate.status === 400) {
      return NextResponse.json(
        {
          ok: false,
          error: aiGate.error,
          details: aiGate.details,
          ai_moderation: true,
          confidence_score: aiGate.confidence_score
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: false, error: aiGate.error }, { status: aiGate.status });
  }

  const { data: rpcData, error: rpcError } = await admin.rpc("finalize_release", {
    p_release_id: releaseId,
    p_client_request_id: clientRequestId
  });

  if (!rpcError) {
    const rawRows = Array.isArray(rpcData) ? rpcData : rpcData != null ? [rpcData] : [];
    if (rawRows.length > 0) {
      const first = rawRows[0];
      let rec: ReleaseRecord | null = null;
      if (looksLikeReleaseTableRow(first)) {
        rec = first;
      } else {
        const { data: refetched, error: refetchErr } = await admin
          .from("releases")
          .select("*")
          .eq("id", releaseId)
          .maybeSingle();
        if (!refetchErr && refetched && looksLikeReleaseTableRow(refetched)) {
          rec = refetched as ReleaseRecord;
        }
      }
      if (rec != null && (rec.status === "processing" || rec.status === "ready")) {
        await notifyReleaseSubmittedForModeration(admin, rec, request.nextUrl.origin);
        return NextResponse.json({ ok: true, record: rec });
      }
    }
  } else {
    const isMissing =
      rpcError.message?.includes("could not find") ||
      rpcError.message?.includes("function") ||
      rpcError.code === "PGRST202";
    if (!isMissing) {
      console.error("[finalize-submit] rpc:", rpcError.message);
    }
  }

  if (current.status !== "pending") {
    return NextResponse.json(
      {
        ok: false,
        error: rpcError
          ? formatErrorMessage(rpcError, "Не удалось завершить отправку.")
          : "Финализация доступна только для релиза в статусе pending."
      },
      { status: 400 }
    );
  }

  const { count: tracksCount, error: tracksCountErr } = await admin
    .from("tracks")
    .select("*", { count: "exact", head: true })
    .eq("release_id", releaseId);
  if (tracksCountErr) {
    console.error("[finalize-submit] tracks count:", tracksCountErr.message);
    return NextResponse.json(
      { ok: false, error: "Не удалось проверить треки перед отправкой." },
      { status: 500 }
    );
  }
  if ((tracksCount ?? 0) < 1) {
    return NextResponse.json(
      { ok: false, error: "Нельзя отправить релиз без загруженных треков." },
      { status: 409 }
    );
  }

  const { data: upd, error: upErr } = await admin
    .from("releases")
    .update({ status: "processing", error_message: null })
    .eq("id", releaseId)
    .eq("client_request_id", clientRequestId)
    .eq("status", "pending")
    .select("*");

  if (upErr) {
    console.error("[finalize-submit] fallback update:", upErr.message);
    return NextResponse.json(
      {
        ok: false,
        error: rpcError
          ? formatErrorMessage(rpcError, "Не удалось завершить отправку.")
          : formatErrorMessage(upErr, "Не удалось обновить статус.")
      },
      { status: 500 }
    );
  }

  const rows = upd as ReleaseRecord[] | null;
  if (!rows || rows.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Обновление не применилось (конкурентное изменение?)." },
      { status: 409 }
    );
  }

  await notifyReleaseSubmittedForModeration(admin, rows[0], request.nextUrl.origin);
  return NextResponse.json({ ok: true, record: rows[0] });
}

export async function POST(request: NextRequest): Promise<Response> {
  const actor = await resolveReleaseActor(request);
  if (!actor) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return handleFinalizeSubmit(request, actor);
}
