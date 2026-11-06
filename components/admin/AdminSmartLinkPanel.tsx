"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { hapticMap } from "@/lib/haptic-map";
import { openSmartLink } from "@/lib/open-smart-link";
import { triggerHaptic } from "@/lib/telegram";

/** «band.link/abc» вместо полного адреса со схемой. */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/**
 * Строка «Ссылка» на странице принятого релиза: видно, какую ссылку получил артист,
 * открыть или скопировать её, поправить. Без ссылки — кнопка в нижней панели, здесь только статус.
 */
export function AdminSmartLinkPanel({
  smartLink,
  upc,
  onEdit
}: {
  smartLink: string | null;
  upc: string | null;
  onEdit: () => void;
}) {
  const link = smartLink?.trim() ?? "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      triggerHaptic("success");
      toast.success("Ссылка скопирована");
    } catch {
      toast.error("Не получилось скопировать");
    }
  };

  return (
    <section className="border-b border-omf-line py-3" aria-labelledby="admin-smart-link">
      <div className="flex items-center gap-3">
        <h2 id="admin-smart-link" className="w-[72px] shrink-0 text-[14px] text-omf-graphite">
          Ссылка
        </h2>
        {link ? (
          <>
            <button
              type="button"
              onClick={() => {
                hapticMap.impactLight();
                openSmartLink(link);
              }}
              title={link}
              className="omf-focus min-w-0 flex-1 truncate text-right text-[15px] font-medium text-omf-ultra-text hover:text-omf-ink"
            >
              {shortUrl(link)}
            </button>
            <button
              type="button"
              onClick={() => void copy()}
              aria-label="Скопировать ссылку"
              className="omf-focus -my-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-omf-graphite hover:bg-omf-surface hover:text-omf-ink"
            >
              <Copy className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="omf-focus shrink-0 py-1 text-[14px] text-omf-ultra-text hover:text-omf-ink"
            >
              Изменить
            </button>
          </>
        ) : (
          <p className="min-w-0 flex-1 text-right text-[15px] font-medium text-omf-yellow">Ещё нет</p>
        )}
      </div>
      {link && upc?.trim() ? (
        <p className="mt-1 text-right text-[13px] tabular-nums text-omf-faint">UPC {upc.trim()}</p>
      ) : null}
    </section>
  );
}
