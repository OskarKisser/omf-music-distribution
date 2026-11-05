import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminSupabaseClient } from "@/lib/admin-release-api-guard";
import { getTelegramAuthContextFromRequest } from "@/lib/api/with-telegram-auth";
import { buildColleagueReleaseForm, type AdminReleaseRow } from "@/lib/admin-release-metadata";
import { COLLEAGUES_DOWNLOAD_TTL_SECONDS, createAdminDownloadPath } from "@/lib/admin-download-token";
import { buildColleaguesMessage, colleaguesChatId } from "@/lib/colleagues-chat";
import { sendTelegramBotDocumentByUrl, sendTelegramBotMessage } from "@/lib/telegram-bot.server";
import type { ReleaseTrackRow } from "@/repositories/releases/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const paramsSchema = z.object({ releaseId: z.string().uuid() });

/**
 * Одной кнопкой: форма релиза, обложка и тексты файлами, ссылка на архив со всем — в рабочий чат коллег.
 * Порядок: сначала файлы, потом форма — в чате форма оказывается последней, под рукой.
 */
export async function POST(
  request: NextRequest,
  routeContext: { params: { releaseId: string } }
): Promise<Response> {
  const guard = await requireAdminSupabaseClient(request, getTelegramAuthContextFromRequest(request));
  if (!guard.ok) return guard.response;

  const parsed = paramsSchema.safeParse(routeContext.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Некорректный ID релиза." }, { status: 400 });
  }
  const { releaseId } = parsed.data;

  const chatId = colleaguesChatId();
  if (!chatId) {
    return NextResponse.json(
      { ok: false, error: "Не настроен чат коллег (TELEGRAM_COLLEAGUES_CHAT_ID)." },
      { status: 503 }
    );
  }

  const { data: release, error: relErr } = await guard.supabase
    .from("releases")
    .select("*")
    .eq("id", releaseId)
    .maybeSingle();
  if (relErr) {
    console.error("[admin/send-colleagues] load:", relErr.message);
    return NextResponse.json({ ok: false, error: "Не удалось загрузить релиз." }, { status: 500 });
  }
  if (!release) {
    return NextResponse.json({ ok: false, error: "Релиз не найден." }, { status: 404 });
  }
  const { data: trackRows, error: trErr } = await guard.supabase
    .from("tracks")
    .select("id, release_id, index, title, explicit, file_path, lyrics, duration")
    .eq("release_id", releaseId)
    .order("index", { ascending: true });
  if (trErr) {
    console.error("[admin/send-colleagues] tracks:", trErr.message);
    return NextResponse.json({ ok: false, error: "Не удалось загрузить треки." }, { status: 500 });
  }
  const tracks = (trackRows ?? []) as ReleaseTrackRow[];
  const row = release as AdminReleaseRow & { artwork_url?: string | null };

  const origin = request.nextUrl.origin;
  const signed = (path: string): string | null => {
    const p = createAdminDownloadPath(path, Date.now(), COLLEAGUES_DOWNLOAD_TTL_SECONDS);
    return p ? `${origin}${p}` : null;
  };
  const base = `/api/admin/releases/${releaseId}`;

  // Файлы — best effort: если Telegram не смог скачать, всё есть в архиве.
  const fileErrors: string[] = [];
  if (row.artwork_url?.trim()) {
    const url = signed(`${base}/download?kind=artwork`);
    if (url) {
      const r = await sendTelegramBotDocumentByUrl({ chatId, documentUrl: url });
      if (!r.ok) fileErrors.push(`обложка: ${r.error}`);
    }
  }
  for (const t of tracks) {
    if (!t.lyrics?.trim() || !t.id) continue;
    const url = signed(`${base}/download?kind=lyrics&trackId=${encodeURIComponent(t.id)}`);
    if (!url) continue;
    const r = await sendTelegramBotDocumentByUrl({ chatId, documentUrl: url });
    if (!r.ok) fileErrors.push(`текст «${t.title}»: ${r.error}`);
  }

  const text = buildColleaguesMessage({
    form: buildColleagueReleaseForm(row, tracks),
    bundleUrl: signed(`${base}/bundle`)
  });
  const sent = await sendTelegramBotMessage({ chatId, text });
  if (!sent.ok) {
    console.error("[admin/send-colleagues] form:", sent.error);
    return NextResponse.json(
      { ok: false, error: `Telegram не принял сообщение: ${sent.error}` },
      { status: 502 }
    );
  }
  if (fileErrors.length > 0) console.warn("[admin/send-colleagues] files:", fileErrors);

  const sentAt = new Date().toISOString();
  await guard.supabase.from("releases").update({ colleagues_sent_at: sentAt }).eq("id", releaseId);
  return NextResponse.json({ ok: true, sentAt, fileErrors });
}
