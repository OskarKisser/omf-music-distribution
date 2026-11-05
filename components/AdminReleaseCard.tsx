"use client";

import { memo, useMemo } from "react";
import Link from "next/link";
import type { Variants } from "framer-motion";
import { Check } from "lucide-react";
import { ReleaseSleeve } from "@/components/ReleaseSleeve";
import { StatusRing } from "@/components/library/StatusRing";
import { AudioPlayerLazy } from "@/components/AudioPlayerLazy";
import {
  getReleaseDisplayTitle,
  type ReleaseRecord,
  type ReleaseTrackRow
} from "@/repositories/releases.repo";
import { normalizeReleaseStatus, type CanonicalReleaseStatus } from "@/lib/release-status";
import { triggerHaptic } from "@/lib/telegram";
import { featuringNamesFromCollaboratorsJson } from "@/lib/collaborators";
import { describeHistoryDecision, describePreviousRejection } from "@/lib/rejection-reasons";
import { getReleaseNextStep, pluralRu } from "@/lib/release-next-step";
import { describePayment, type PaymentTone } from "@/lib/release-payment";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<CanonicalReleaseStatus, string> = {
  draft: "черновик",
  pending: "не отправлен",
  processing: "на проверке",
  ready: "принят",
  failed: "отклонён",
  removed: "удалён с площадок",
  unknown: "статус не определён"
};

function statusTextClass(status: CanonicalReleaseStatus): string {
  if (status === "processing") return "text-omf-yellow";
  if (status === "ready") return "text-omf-green";
  if (status === "failed") return "text-omf-red";
  return "text-omf-graphite";
}
/** Оплата текстом и только когда что-то не так: «оплачено» — обычное состояние, его не показываем. */
const PAYMENT_TEXT_CLASS: Record<PaymentTone, string> = {
  done: "text-omf-green",
  wait: "text-omf-yellow",
  problem: "text-omf-yellow",
  muted: "text-omf-faint"
};

/** «ждёт 40 мин», «ждёт 26 ч», «ждёт 3 дн» + цвет: больше суток — красный, больше 12 ч — жёлтый. */
export function describeQueueWait(since: string | null | undefined, now: number = Date.now()) {
  const t = since ? new Date(since).getTime() : NaN;
  if (!Number.isFinite(t)) return null;
  const minutes = Math.max(0, Math.round((now - t) / 60000));
  const hours = Math.floor(minutes / 60);
  const label =
    minutes < 60 ? `ждёт ${Math.max(1, minutes)} мин` : hours < 48 ? `ждёт ${hours} ч` : `ждёт ${Math.floor(hours / 24)} дн`;
  const tone = hours >= 24 ? "text-omf-red" : hours >= 12 ? "text-omf-yellow" : "text-omf-graphite";
  return { label, tone };
}

function releaseTypeLabel(type: ReleaseRecord["release_type"]): string {
  if (type === "single") return "Сингл";
  if (type === "ep") return "EP";
  return "Альбом";
}

function buildAudioItems(release: ReleaseRecord, tracks: ReleaseTrackRow[]) {
  if (tracks.length > 0) {
    return tracks
      .filter((t) => t.file_path && t.file_path.length > 0)
      .map((t, i) => ({
        key: `${t.index}-${i}`,
        label: t.title.trim() || `Трек ${t.index + 1}`,
        src: t.file_path as string
      }));
  }
  if (release.audio_url) {
    return [
      {
        key: "main",
        label: getReleaseDisplayTitle(release) || "Трек",
        src: release.audio_url
      }
    ];
  }
  return [];
}

type AdminReleaseCardProps = {
  release: ReleaseRecord;
  tracks: ReleaseTrackRow[];
  /** Индекс в списке (приоритет обложки для первых карточек). */
  index: number;
  /** Варианты для stagger-анимации очереди (родитель задаёт staggerChildren). */
  listVariants?: Variants;
  busy: boolean;
  onOpenApprove: () => void;
  /** Открыть модальное окно выбора причины отклонения */
  onOpenReject: () => void;
  /** Ссылка на страницу детали модерации */
  detailHref?: string;
  /** LCP / приоритет загрузки для первых карточек в списке */
  artworkPriority?: boolean;
  /** Показать кнопки «Принять» / «Вернуть» (очередь). В истории — false. */
  showModerationActions?: boolean;
  /** Показать встроенный блок прослушивания на карточке списка. */
  showAudioPreview?: boolean;
  /** Режим выбора в очереди: тап по карточке отмечает её, кнопки решения и переход скрыты. */
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
};


function AdminReleaseCardInner({
  release,
  tracks,
  index: _index,
  listVariants: _listVariants,
  busy,
  onOpenApprove,
  onOpenReject,
  detailHref,
  artworkPriority = false,
  showModerationActions = true,
  showAudioPreview = true,
  selectMode = false,
  selected = false,
  onToggleSelect
}: AdminReleaseCardProps) {
  const canonical = normalizeReleaseStatus(release.status);
  const displayTitle = getReleaseDisplayTitle(release);
  const audioItems = useMemo(() => buildAudioItems(release, tracks), [release, tracks]);
  const featuringNames = useMemo(
    () => featuringNamesFromCollaboratorsJson(release.collaborators),
    [release.collaborators]
  );
  const featuringLabel = useMemo(() => featuringNames.join(", "), [featuringNames]);
  const createdAtLabel = useMemo(
    () =>
      new Date(release.created_at).toLocaleString("ru-RU", {
        day: "numeric",
        month: "short"
      }),
    [release.created_at]
  );
  const hasError = (release.error_message ?? "").trim().length > 0;
  const payment = describePayment(release.payment_status);
  const previousRejection = showModerationActions ? describePreviousRejection(release) : null;
  /** В истории: почему вернули / какая ссылка ушла артисту. */
  const decisionLine = showModerationActions ? null : describeHistoryDecision(release);
  const trackCount = tracks.length;
  const wait = showModerationActions
    ? describeQueueWait((release as ReleaseRecord & { submitted_at?: string | null }).submitted_at ?? release.created_at)
    : null;
  const metaLine = [
    releaseTypeLabel(release.release_type),
    trackCount > 1 ? `${trackCount} ${pluralRu(trackCount, ["трек", "трека", "треков"])}` : null,
    showModerationActions ? null : `создан ${createdAtLabel}`
  ]
    .filter(Boolean)
    .join(" · ");
  const errorText = (release.error_message ?? "").trim();
  const showPayment = payment.tone !== "done";

  const header = (
    <>
      <div className="relative w-14 shrink-0">
        <ReleaseSleeve
          seed={release.id}
          title={displayTitle}
          artist={release.artist_name}
          coverUrl={release.artwork_url}
          size="thumb"
          priority={artworkPriority}
        />
        {selectMode ? (
          <span
            className={cn(
              "absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors",
              selected ? "border-omf-bg bg-omf-ultra text-white" : "border-white/80 bg-black/40"
            )}
            aria-hidden
          >
            {selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[16px] font-semibold leading-tight tracking-[-0.01em]">{displayTitle}</p>
        <p className="mt-0.5 min-w-0 truncate text-[13px] text-omf-graphite">{release.artist_name}</p>
        {featuringNames.length > 0 ? (
          <p className="truncate text-[13px] text-omf-graphite" title={featuringLabel}>
            feat. {featuringLabel}
          </p>
        ) : null}
        <p className="mt-0.5 text-[13px] text-omf-faint">
          {metaLine}
          {wait ? (
            <>
              {" · "}
              <span className={wait.tone}>{wait.label}</span>
            </>
          ) : null}
        </p>
        {decisionLine ? (
          <p className="mt-1.5 line-clamp-2 break-words text-[13px] leading-snug text-omf-graphite">
            {decisionLine}
          </p>
        ) : null}
        {previousRejection ? (
          <p className="mt-1.5 text-[13px] leading-snug">
            <span className="font-medium text-omf-yellow">
              Повторно
              {previousRejection.count > 1
                ? `, вернули ${previousRejection.count} ${pluralRu(previousRejection.count, ["раз", "раза", "раз"])}`
                : ""}
            </span>
            {previousRejection.summary ? (
              <span className="text-omf-graphite"> · проверь: {previousRejection.summary}</span>
            ) : null}
          </p>
        ) : null}
        {showModerationActions && canonical !== "processing" ? (
          <p className={cn("mt-1 text-[13px]", statusTextClass(canonical))}>{STATUS_LABEL[canonical]}</p>
        ) : null}
        {hasError ? <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-[#ff9a9d]">{errorText}</p> : null}
        {showPayment ? (
          <p className={cn("mt-1 text-[13px]", PAYMENT_TEXT_CLASS[payment.tone])}>
            {payment.label.charAt(0).toUpperCase() + payment.label.slice(1)}
          </p>
        ) : null}
      </div>
      {!showModerationActions ? (
        <StatusRing
          kind={getReleaseNextStep({ status: release.status, smartLink: release.smart_link }).kind}
          size={44}
          className="self-center"
        />
      ) : null}
    </>
  );

  return (
    <article className="border-b border-omf-line py-3.5">
      {selectMode ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          onClick={() => {
            triggerHaptic("light");
            onToggleSelect?.();
          }}
          className={cn(
            "omf-focus -m-1 flex w-[calc(100%+0.5rem)] gap-3 rounded-[14px] p-1 text-left transition-colors",
            selected ? "bg-omf-surface-2" : "hover:bg-omf-surface-2"
          )}
        >
          {header}
        </button>
      ) : detailHref ? (
        <Link
          href={detailHref}
          className="omf-focus flex gap-3 rounded-[12px] transition-transform active:scale-[0.99]"
        >
          {header}
        </Link>
      ) : (
        <div className="flex gap-3">{header}</div>
      )}

      {showAudioPreview ? (
        <div className="mt-3 space-y-2">
          {audioItems.length === 0 ? (
            <p className="text-[14px] text-omf-graphite">Аудио пока нет, послушать нечего.</p>
          ) : (
            audioItems.map((item) => (
              <AudioPlayerLazy key={item.key} src={item.src} label={item.label} variant="admin" />
            ))
          )}
        </div>
      ) : null}

      {showModerationActions && !selectMode ? (
        <div className="ml-[68px] mt-2.5 flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              triggerHaptic("light");
              onOpenApprove();
            }}
            className="omf-btn-primary h-9 min-h-0 rounded-[10px] px-4 text-[14px] font-medium disabled:opacity-50"
          >
            Принять
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              triggerHaptic("light");
              onOpenReject();
            }}
            className="omf-focus h-9 rounded-[10px] bg-omf-surface-2 px-4 text-[14px] font-medium text-omf-ink transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            Вернуть
          </button>
          {detailHref ? (
            <Link href={detailHref} className="omf-focus ml-auto py-2 pl-2 text-[14px] text-omf-graphite hover:text-omf-ink">
              Открыть ›
            </Link>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export const AdminReleaseCard = memo(AdminReleaseCardInner);
