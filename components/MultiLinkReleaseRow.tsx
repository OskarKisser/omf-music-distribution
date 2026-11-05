"use client";

import { Copy } from "lucide-react";
import { ReleaseSleeve } from "@/components/ReleaseSleeve";
import { toast } from "sonner";
import { openSmartLink } from "@/lib/open-smart-link";
import { hapticMap } from "@/lib/haptic-map";

export type MultiLinkReleaseRowProps = {
  releaseId: string;
  title: string;
  artist: string;
  smartLink: string;
  coverUrl?: string | null;
  index?: number;
};

function compactUrlForCard(url: string): string {
  const t = url.trim();
  try {
    const u = new URL(t);
    const path = u.pathname.replace(/\/$/, "");
    const tail = path && path !== "/" ? path : "";
    return `${u.hostname.replace(/^www\./, "")}${tail}`;
  } catch {
    return t.length > 48 ? `${t.slice(0, 45)}…` : t;
  }
}

/** Строка раздела «Ссылки»: тап открывает ссылку, кнопка справа копирует. */
export function MultiLinkReleaseRow({ releaseId, title, artist, smartLink, coverUrl }: MultiLinkReleaseRowProps) {
  const lineUrl = compactUrlForCard(smartLink);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(smartLink.trim());
      hapticMap.notificationSuccess();
      toast.success("Ссылка скопирована");
    } catch {
      toast.error("Не получилось скопировать. Открой ссылку и скопируй адрес из браузера.");
    }
  };

  return (
    <div className="-mx-2 grid grid-cols-[1fr_40px] items-center gap-3 rounded-[14px] px-2 py-2">
      <button
        type="button"
        onClick={() => {
          hapticMap.impactLight();
          openSmartLink(smartLink);
        }}
        className="omf-focus grid min-w-0 grid-cols-[48px_1fr] items-center gap-3.5 rounded-[12px] text-left transition-transform active:scale-[0.98]"
      >
        <span className="block w-12">
          <ReleaseSleeve seed={releaseId} title={title} artist={artist} coverUrl={coverUrl} size="thumb" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[16px] font-semibold tracking-[-0.01em] text-omf-ink">{title}</span>
          <span className="mt-0.5 block truncate text-[13px] text-omf-ultra-text" title={smartLink}>
            {lineUrl}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Скопировать ссылку на «${title}»`}
        className="omf-focus flex h-10 w-10 items-center justify-center rounded-[12px] bg-omf-surface-2 text-omf-ink transition-transform active:scale-95"
      >
        <Copy className="h-[18px] w-[18px]" aria-hidden />
      </button>
    </div>
  );
}
