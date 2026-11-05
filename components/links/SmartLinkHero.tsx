"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, QrCode, Send } from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { ReleaseSleeve } from "@/components/ReleaseSleeve";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { openSmartLink, shareSmartLink } from "@/lib/open-smart-link";
import { formatReleaseDateDayMonthRu } from "@/lib/admin-release-publish";
import { releaseTypeLabel } from "@/lib/release-type-label";
import { hapticMap } from "@/lib/haptic-map";

type Props = {
  releaseId: string;
  title: string;
  artist: string;
  smartLink: string;
  coverUrl?: string | null;
  releaseType?: string | null;
  releaseDate?: string | null;
};

/** «band.link/nochnoy» вместо полного адреса — читается с одного взгляда. */
export function compactSmartLink(url: string): string {
  const t = url.trim();
  try {
    const u = new URL(t);
    const path = u.pathname.replace(/\/$/, "");
    return `${u.hostname.replace(/^www\./, "")}${path && path !== "/" ? path : ""}`;
  } catch {
    return t.length > 48 ? `${t.slice(0, 45)}…` : t;
  }
}

/**
 * Свежая готовая ссылка крупно: обложка, адрес с копированием, «Поделиться» и QR-код.
 * Это главное, что артист делает на экране «Ссылки», — поэтому одним блоком наверху.
 */
export function SmartLinkHero({ releaseId, title, artist, smartLink, coverUrl, releaseType, releaseDate }: Props) {
  const [qrOpen, setQrOpen] = useState(false);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const closeQr = useCallback(() => setQrOpen(false), []);

  useEffect(() => {
    if (!qrOpen || qrSrc) return;
    let cancelled = false;
    void QRCode.toDataURL(smartLink.trim(), { margin: 1, width: 560, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setQrSrc(url);
      })
      .catch(() => {
        if (!cancelled) toast.error("Не получилось сделать QR-код");
      });
    return () => {
      cancelled = true;
    };
  }, [qrOpen, qrSrc, smartLink]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(smartLink.trim());
      hapticMap.notificationSuccess();
      toast.success("Ссылка скопирована");
    } catch {
      toast.error("Не получилось скопировать. Открой ссылку и скопируй адрес из браузера.");
    }
  };

  const meta = [releaseTypeLabel(releaseType), releaseDate ? `выход ${formatReleaseDateDayMonthRu(releaseDate) ?? ""}`.trim() : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <section aria-label={`Ссылка на «${title}»`} className="mb-8">
      <button
        type="button"
        onClick={() => {
          hapticMap.impactLight();
          openSmartLink(smartLink);
        }}
        className="omf-focus flex w-full items-end gap-4 rounded-[8px] text-left"
      >
        <span className="block w-[150px] shrink-0">
          <ReleaseSleeve seed={releaseId} title={title} artist={artist} coverUrl={coverUrl} size="tile" priority />
        </span>
        <span className="min-w-0 pb-1">
          <span className="block break-words text-[20px] font-bold leading-tight tracking-[-0.02em] text-omf-ink">
            {title}
          </span>
          {meta ? <span className="mt-1 block text-[14px] text-omf-graphite">{meta}</span> : null}
        </span>
      </button>

      <div className="mt-4 flex h-[52px] items-center justify-between gap-2 rounded-control bg-omf-surface pl-4 pr-1.5">
        <span className="min-w-0 truncate text-[15px] text-omf-ultra-text" title={smartLink}>
          {compactSmartLink(smartLink)}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="omf-focus flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] bg-omf-surface-2 px-3.5 text-[14px] text-omf-ink transition-transform active:scale-95"
        >
          <Copy className="h-4 w-4" aria-hidden />
          Копировать
        </button>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => {
            hapticMap.impactLight();
            shareSmartLink(smartLink, `${artist} — ${title}`);
          }}
          className="omf-btn-primary h-[52px] gap-2"
        >
          <Send className="h-4 w-4" aria-hidden />
          Поделиться
        </button>
        <button
          type="button"
          onClick={() => {
            hapticMap.impactLight();
            setQrOpen(true);
          }}
          className="omf-btn-secondary h-[52px] gap-2"
        >
          <QrCode className="h-4 w-4" aria-hidden />
          QR-код
        </button>
      </div>

      <BottomSheet
        open={qrOpen}
        onClose={closeQr}
        header={(titleId) => (
          <h2 id={titleId} className="text-[17px] font-semibold tracking-[-0.02em]">
            QR-код «{title}»
          </h2>
        )}
      >
        <div className="mx-auto aspect-square w-full max-w-[280px] rounded-[12px] bg-white p-3">
          {qrSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL, оптимизировать нечего
            <img src={qrSrc} alt={`QR-код ссылки ${compactSmartLink(smartLink)}`} className="h-full w-full" />
          ) : (
            <div className="h-full w-full animate-pulse rounded-[6px] bg-neutral-200" />
          )}
        </div>
        <p className="mt-4 text-center text-[14px] leading-relaxed text-omf-graphite">
          Покажи на концерте или добавь на афишу — камера телефона откроет {compactSmartLink(smartLink)}.
        </p>
      </BottomSheet>
    </section>
  );
}
