"use client";

import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  /** Шапка листа: слева то, что передали (обложка + название или заголовок), справа крестик. */
  header: (titleId: string) => ReactNode;
  children: ReactNode;
};

/**
 * Лист снизу без жестов перетаскивания: в Telegram свайп вниз закрывает само мини-приложение.
 * Закрывается фоном, крестиком и Esc; пока открыт, страница под ним не прокручивается.
 * Рисуется порталом в body: контент страницы живёт в своём слое (z-[1]) под нижним меню.
 */
export function BottomSheet({ open, onClose, header, children }: BottomSheetProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center" role="presentation">
      <button type="button" aria-label="Закрыть" onClick={onClose} className="omf-backdrop-in absolute inset-0 cursor-default bg-black/60" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="omf-sheet-in relative max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-[22px] bg-omf-surface px-5 pt-2.5"
        style={{ paddingBottom: "calc(1.75rem + env(safe-area-inset-bottom, 0px) + var(--keyboard-overlap, 0px))" }}
      >
        <div className="mx-auto mb-3.5 h-1 w-[38px] rounded-full bg-omf-line-strong" aria-hidden />
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">{header(titleId)}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="omf-focus flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-omf-graphite hover:bg-omf-surface-2 hover:text-omf-ink"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}
