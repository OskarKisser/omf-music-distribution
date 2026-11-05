"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, ChevronDown, Copy, Download, Send } from "lucide-react";
import { ReleaseSleeve } from "@/components/ReleaseSleeve";
import { cn } from "@/lib/utils";
import { parseCollaboratorsFromDb } from "@/lib/collaborators";
import { debugInit } from "@/lib/debug";
import { openSmartLink, shareSmartLink } from "@/lib/open-smart-link";
import { PERFORMANCE_LANGUAGE_LABELS, parsePerformanceLanguage } from "@/lib/performance-language";
import { normalizeReleaseStatus } from "@/lib/release-status";
import { shouldShowSmartLinkCta } from "@/lib/smart-link-cta";
import { markStatusSeen } from "@/lib/seen-release-status";
import { isAdminUi } from "@/lib/admin";
import { USER_REQUEST_TIMEOUT_MESSAGE } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { getTelegramUserId, initTelegramWebApp } from "@/lib/telegram";
import { getReleaseDisplayTitle } from "@/repositories/releases/types";
import { getReleaseWithTracks } from "@/repositories/releases/queries";
import { ReleaseApiError } from "@/lib/api/release-client";
import { RejectionNotice } from "@/components/RejectionNotice";
import { describeRejection } from "@/lib/rejection-reasons";
import { reopenRejectedRelease, resumeDraftFromRelease } from "@/features/release/createRelease/actions";
import {
  DSP_REVIEW_DAYS_TEXT,
  getReleaseNextStep,
  MODERATION_SLA_HOURS,
  type NextStepKind,
  type ReleaseNextStep
} from "@/lib/release-next-step";
import { StatusRing } from "@/components/library/StatusRing";
import { ReleaseTakedownRequest } from "@/components/ReleaseTakedownRequest";
import { useCreateReleaseDraftStore } from "@/features/release/createRelease/store";
import { hapticMap } from "@/lib/haptic-map";
import { toast } from "sonner";

type ReleaseDetailsTrackRow = {
  title: string;
  explicit: boolean;
  duration: number | null;
  index: number;
};

type ReleaseDetailsRow = {
  id: string;
  user_id: number | string;
  artist_name: string;
  track_name: string;
  title?: string | null;
  artwork_url: string | null;
  audio_url: string | null;
  release_type: string;
  genre: string;
  sub_genre?: string | null;
  status: string;
  error_message: string | null;
  admin_notes?: string | null;
  rejection_reasons?: string[] | null;
  submitted_at?: string | null;
  created_at: string;
  smart_link: string | null;
  release_date?: string | null;
  explicit?: boolean | null;
  is_explicit?: boolean | null;
  performance_language?: string | null;
  isrc?: string | null;
  upc?: string | null;
  collaborators?: unknown;
  music_author?: string | null;
  takedown_requested_at?: string | null;
  tracks: ReleaseDetailsTrackRow[];
};

function formatReleaseTypeLabel(type: string | null | undefined): string {
  const t = (type ?? "").toLowerCase();
  if (t === "single") return "Сингл";
  if (t === "ep") return "EP";
  if (t === "album") return "Альбом";
  const s = (type ?? "").trim();
  return s.length > 0 ? s.toUpperCase() : "—";
}

function formatReleaseDateRu(d: string | null | undefined): string | null {
  if (d == null) return null;
  const raw = String(d).trim();
  if (!raw) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00`) : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed
    .toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
    .replace(/\s*г\.?$/, "");
}

function formatTrackDurationSec(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(Number(sec))) return null;
  const n = Math.floor(Number(sec));
  const s = n % 60;
  const m = Math.floor(n / 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatFeaturingProducers(collaboratorsRaw: unknown): string | null {
  const list = parseCollaboratorsFromDb(collaboratorsRaw);
  const parts: string[] = [];
  for (const c of list) {
    const name = c.name.trim();
    if (!name) continue;
    if (c.role === "featuring") parts.push(`${name} (фит)`);
    else if (c.role === "producer") parts.push(`${name} (продюсер)`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Заголовок рядом с кольцом: для проверки — сколько уже ждём («На проверке 5 ч»). */
function statusHeadline(status: ReleaseNextStep): { title: string } {
  if (status.kind === "waiting") return { title: status.cardLine };
  return { title: status.title };
}

/** Одна строка под заголовком статуса; подробности — в «Помощи». */
function statusLine(kind: NextStepKind, notifiesInTelegram: boolean): string {
  const where = notifiesInTelegram ? "сюда и в Telegram" : "сюда";
  switch (kind) {
    case "approved_link":
      return "Релиз на площадках. Отправь ссылку слушателям.";
    case "approved_no_link":
      return `Ушёл на площадки. Ссылку пришлём ${where} через ${DSP_REVIEW_DAYS_TEXT}.`;
    case "waiting":
      return `Обычно до ${MODERATION_SLA_HOURS} часов. Решение придёт ${where}.`;
    case "waiting_long":
      return `Обычно это до ${MODERATION_SLA_HOURS} часов. Напиши нам, посмотрим, что случилось.`;
    case "fix":
      return "Исправь замечание и отправь релиз снова.";
    case "finish_draft":
      return "Продолжи с того места, где остановился, и отправь на проверку.";
    case "submit":
      return "Файлы загружены, осталось отправить на проверку.";
    default:
      return "Обнови экран чуть позже.";
  }
}

async function copySmartLink(link: string): Promise<void> {
  hapticMap.impactLight();
  try {
    await navigator.clipboard.writeText(link);
    toast.success("Ссылка скопирована");
  } catch {
    toast.error("Не получилось скопировать. Зажми ссылку под кнопкой и скопируй вручную.");
  }
}

const RELEASE_DETAILS_TIMEOUT_MS = 12000;

export default function ReleaseDetailsClient() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [userId, setUserId] = useState<number | null>(null);
  const [webUserId, setWebUserId] = useState<string | null>(null);
  const [identityResolved, setIdentityResolved] = useState(false);
  const [release, setRelease] = useState<ReleaseDetailsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);

  useEffect(() => {
    debugInit("release/details", "init start");
    initTelegramWebApp();
    setUserId(getTelegramUserId());
    void supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        setWebUserId(session?.user?.id ?? null);
      })
      .finally(() => {
        setIdentityResolved(true);
      });
    debugInit("release/details", "init done");
  }, []);

  useEffect(() => {
    if (!params.id) return;
    if (!identityResolved) return;
    const isAdminView = isAdminUi();
    const hasIdentity = isAdminView || userId != null || webUserId != null;
    if (!hasIdentity && process.env.NODE_ENV === "production") {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;
    const load = async () => {
      setLoading(true);
      setError(null);
      const startedAt = Date.now();
      debugInit("release/details", "load start", { releaseId: params.id, userId, webUserId });
      try {
        // Через API владельца: RLS по anon-ключу больше не отдаёт релизы по x-telegram-user-id.
        const queryPromise = getReleaseWithTracks(params.id).catch((e: unknown) => {
          if (e instanceof ReleaseApiError && (e.status === 404 || e.status === 403)) return null;
          throw e;
        });
        queryPromise.catch(() => {});
        const timeoutPromise = new Promise<Awaited<typeof queryPromise>>((_, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(new Error(USER_REQUEST_TIMEOUT_MESSAGE));
          }, RELEASE_DETAILS_TIMEOUT_MS);
        });

        const data = await Promise.race([queryPromise, timeoutPromise]);
        if (timeoutId != null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (!cancelled) {
          if (!data) {
            setRelease(null);
          } else {
            const tracks: ReleaseDetailsTrackRow[] = data.tracks.map((row) => ({
              title: typeof row.title === "string" ? row.title : "",
              explicit: Boolean(row.explicit),
              duration: row.duration ?? null,
              index: row.index ?? 0
            }));
            setRelease({
              ...(data.record as unknown as Omit<ReleaseDetailsRow, "tracks">),
              tracks
            });
          }
        }
        debugInit("release/details", "load success", {
          releaseId: params.id,
          hasData: Boolean(data),
          durationMs: Date.now() - startedAt
        });
      } catch (e: unknown) {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
        console.error("[release/details] load failed", e);
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Не удалось загрузить релиз.");
        }
      } finally {
        if (!cancelled) setLoading(false);
        debugInit("release/details", "load finished", {
          releaseId: params.id,
          durationMs: Date.now() - startedAt
        });
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [params.id, userId, webUserId, identityResolved]);

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto w-full max-w-lg px-1 pb-40 pt-4 text-omf-ink">{children}</div>
  );

  const backButton = (
    <button
      type="button"
      onClick={() => router.back()}
      className="omf-focus -ml-2 mb-4 inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[14px] text-omf-graphite transition-colors hover:text-omf-ink"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Релизы
    </button>
  );

  const handleFixRejected = async (releaseId: string) => {
    hapticMap.impactLight();
    setFixing(true);
    try {
      const path = await reopenRejectedRelease(releaseId);
      if (!path) {
        toast.error(
          useCreateReleaseDraftStore.getState().submitError ?? "Не удалось открыть релиз для правок."
        );
        return;
      }
      router.push(path);
    } finally {
      setFixing(false);
    }
  };

  const handleResumeDraft = async (releaseId: string) => {
    hapticMap.impactLight();
    setFixing(true);
    try {
      const path = await resumeDraftFromRelease(releaseId);
      if (!path) {
        toast.error(useCreateReleaseDraftStore.getState().submitError ?? "Не удалось открыть черновик.");
        return;
      }
      router.push(path);
    } finally {
      setFixing(false);
    }
  };

  useEffect(() => {
    if (!release) return;
    const st = normalizeReleaseStatus(release.status);
    if (st === "ready" || st === "failed") markStatusSeen(release.id, st);
  }, [release]);

  if (!identityResolved || loading) {
    return shell(
      <div aria-busy="true">
        {backButton}
        <div className="mx-auto aspect-square w-[72%] max-w-[300px] animate-pulse rounded-sleeve bg-omf-surface" />
        <div className="mx-auto mt-6 h-7 w-1/2 animate-pulse rounded bg-omf-surface" />
        <div className="mx-auto mt-2 h-4 w-1/3 animate-pulse rounded bg-omf-surface" />
      </div>
    );
  }

  if (userId == null && webUserId == null && process.env.NODE_ENV === "production") {
    return shell(
      <>
        <h1 className="text-[24px] font-extrabold tracking-[-0.03em]">Нужен вход</h1>
        <p className="mt-2 text-[15px] text-omf-graphite">
          Открой приложение из Telegram или войди в веб-кабинет, чтобы увидеть релиз.
        </p>
      </>
    );
  }

  if (error) {
    return shell(
      <>
        {backButton}
        <h1 className="text-[24px] font-extrabold tracking-[-0.03em]">Не удалось открыть релиз</h1>
        <p className="mt-2 text-[15px] text-omf-graphite">{error}</p>
      </>
    );
  }

  if (!release) {
    return shell(
      <>
        {backButton}
        <h1 className="text-[24px] font-extrabold tracking-[-0.03em]">Релиз не найден</h1>
        <p className="mt-2 text-[15px] text-omf-graphite">
          Возможно, его удалили или ссылка открыта с другого аккаунта.
        </p>
      </>
    );
  }

  const displayTitle = getReleaseDisplayTitle(release) || "Без названия";
  const genreLine = [release.genre?.trim(), release.sub_genre?.trim()].filter(Boolean).join(", ");
  const releaseDateLabel = formatReleaseDateRu(release.release_date ?? null);
  const langLabel = PERFORMANCE_LANGUAGE_LABELS[parsePerformanceLanguage(release.performance_language)];
  const isExplicit = Boolean(release.explicit ?? release.is_explicit);
  const featuringLine = formatFeaturingProducers(release.collaborators);
  const sortedTracks = [...release.tracks].sort((a, b) => a.index - b.index);
  const smartLink =
    shouldShowSmartLinkCta(release.status, release.smart_link) && release.smart_link?.trim()
      ? release.smart_link.trim()
      : null;

  const typeLabel = formatReleaseTypeLabel(release.release_type);
  const passportRows: { label: string; value: string }[] = [{ label: "Формат", value: typeLabel }];
  if (genreLine.length > 0) passportRows.push({ label: "Жанр", value: genreLine });
  if (releaseDateLabel) passportRows.push({ label: "Дата выхода", value: releaseDateLabel });
  passportRows.push({ label: "Язык", value: langLabel });
  passportRows.push({ label: "Мат в тексте", value: isExplicit ? "Есть" : "Нет" });
  const musicAuthor = release.music_author?.trim();
  if (musicAuthor) passportRows.push({ label: "Автор бита", value: musicAuthor });
  if (featuringLine) passportRows.push({ label: "Участники", value: featuringLine });
  const isrc = release.isrc?.trim();
  if (isrc) passportRows.push({ label: "ISRC", value: isrc });
  const upc = release.upc?.trim();
  if (upc) passportRows.push({ label: "UPC", value: upc });
  /** Свёрнутая строка «Данные релиза»: формат и дата без года. */
  const dataSummary = [typeLabel, releaseDateLabel?.replace(/\s\d{4}$/, "")].filter(Boolean).join(", ");

  const notifiesInTelegram = userId != null;
  const status = getReleaseNextStep({
    status: release.status,
    smartLink,
    submittedAt: release.submitted_at,
    notifiesInTelegram
  });
  const headline = statusHeadline(status);

  return shell(
    <>
      {backButton}

      <div className="mx-auto w-[58%] max-w-[232px]">
        <ReleaseSleeve
          seed={release.id}
          title={displayTitle}
          artist={release.artist_name}
          coverUrl={release.artwork_url}
          size="hero"
          priority
        />
      </div>

      <h1 className="mt-5 break-words text-center text-[28px] font-bold leading-none tracking-[-0.045em]">
        {displayTitle}
      </h1>
      <p className="mt-1.5 text-center text-[14px] text-omf-graphite">{release.artist_name}</p>

      <section aria-labelledby="release-status-title" className="mt-6">
        <div className="grid grid-cols-[52px_1fr] items-center gap-3.5">
          <StatusRing kind={status.kind} size={52} />
          <div className="min-w-0">
            <h2 id="release-status-title" className="text-[17px] font-semibold tracking-[-0.02em]">
              {headline.title}
            </h2>
            <p className="mt-0.5 text-[13.5px] leading-snug text-omf-graphite">
              {statusLine(status.kind, notifiesInTelegram)}
            </p>
          </div>
        </div>

        {status.kind === "fix" ? (
          <RejectionNotice
            className="mt-4 rounded-[14px] border-0 bg-[rgba(229,72,77,0.1)] p-3.5"
            showTitle={false}
            summary={describeRejection({
              adminNotes: release.admin_notes,
              errorMessage: release.error_message,
              rejectionReasons: release.rejection_reasons
            })}
            fixing={fixing}
            onFix={() => void handleFixRejected(release.id)}
          />
        ) : null}

        {smartLink ? (
          <>
            <div className="mt-4 grid grid-cols-[1fr_52px] gap-2">
              <button
                type="button"
                onClick={() => {
                  hapticMap.impactLight();
                  shareSmartLink(smartLink, `${release.artist_name} — ${displayTitle}`);
                }}
                className="omf-btn-primary h-[52px] w-full font-medium"
              >
                <Send className="h-[18px] w-[18px]" aria-hidden />
                Поделиться ссылкой
              </button>
              <button
                type="button"
                onClick={() => void copySmartLink(smartLink)}
                aria-label="Скопировать ссылку"
                className="omf-focus flex h-[52px] items-center justify-center rounded-control bg-omf-surface text-omf-ink transition-transform active:scale-95"
              >
                <Copy className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <button
              type="button"
              onClick={() => openSmartLink(smartLink)}
              className="omf-focus mx-auto mt-2.5 flex items-center gap-1 rounded-full px-2 py-1 text-[13px] text-omf-ultra-text hover:text-omf-ink"
            >
              {smartLink.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </>
        ) : null}

        {status.kind === "waiting_long" ? (
          <Link href="/requirements" className="omf-btn-secondary mt-4 w-full">
            Написать в поддержку
          </Link>
        ) : null}
        {status.kind === "finish_draft" || status.kind === "submit" ? (
          <button
            type="button"
            onClick={() => void handleResumeDraft(release.id)}
            disabled={fixing}
            className="omf-btn-primary mt-4 h-[52px] w-full font-medium disabled:opacity-50"
          >
            {fixing ? "Открываем…" : "Продолжить"}
          </button>
        ) : null}
      </section>

      <div className="mt-6 border-t border-omf-line">
        {sortedTracks.length > 1 ? (
          <ol aria-label={`Треки, ${sortedTracks.length}`}>
            {sortedTracks.map((t, i) => {
              const dur = formatTrackDurationSec(t.duration);
              return (
                <li
                  key={`${t.index}-${i}`}
                  className="flex items-baseline gap-3 border-b border-omf-line py-3 text-[15px]"
                >
                  <span className="w-4 shrink-0 tabular-nums text-omf-faint">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{t.title.trim() || "Без названия"}</span>
                  {t.explicit ? (
                    <span
                      className="shrink-0 rounded-[4px] bg-omf-surface-2 px-1.5 py-0.5 text-[11px] font-bold text-omf-graphite"
                      title="Есть мат"
                    >
                      E
                    </span>
                  ) : null}
                  {dur ? <span className="shrink-0 tabular-nums text-omf-graphite">{dur}</span> : null}
                </li>
              );
            })}
          </ol>
        ) : null}

        <button
          type="button"
          onClick={() => setDataOpen((v) => !v)}
          aria-expanded={dataOpen}
          aria-controls="release-data"
          className="omf-focus flex w-full items-center justify-between gap-4 border-b border-omf-line py-4 text-left text-[15px]"
        >
          Данные релиза
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-omf-graphite">
            <span className="truncate">{dataSummary}</span>
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 text-omf-faint transition-transform", dataOpen && "rotate-180")}
              aria-hidden
            />
          </span>
        </button>
        {dataOpen ? (
          <div id="release-data">
            <dl>
              {passportRows.map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-4 border-b border-omf-line py-3">
                  <dt className="shrink-0 text-[14px] text-omf-graphite">{row.label}</dt>
                  <dd className="min-w-0 break-words text-right text-[15px]">{row.value}</dd>
                </div>
              ))}
            </dl>
            {release.audio_url ? (
              <a
                href={release.audio_url}
                target="_blank"
                rel="noreferrer"
                className="omf-focus mt-3 inline-flex items-center gap-1.5 rounded-full py-1 text-[14px] text-omf-ultra-text hover:text-omf-ink"
              >
                <Download className="h-4 w-4" aria-hidden />
                Скачать аудио
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      <ReleaseTakedownRequest
        releaseId={release.id}
        status={release.status}
        takedownRequestedAt={release.takedown_requested_at}
        onRequested={(at) => setRelease((r) => (r ? { ...r, takedown_requested_at: at } : r))}
      />
    </>
  );
}
