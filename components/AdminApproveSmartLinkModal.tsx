"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { SPRING_UI } from "@/lib/motion-spring";
import { formatReleaseDateDayMonthRu, normalizeReleaseDate, normalizeUpc } from "@/lib/admin-release-publish";
import { DSP_REVIEW_DAYS_TEXT } from "@/lib/release-next-step";
import { describePayment, isPaymentConfirmed } from "@/lib/release-payment";
import { BusyLabel } from "@/components/BusyLabel";

export type ApproveModalMode = "accept" | "link";

type Props = {
  releaseId: string | null;
  /** accept — релиз на проверке («Принять», ссылка по желанию); link — уже принят, нужна ссылка. */
  mode: ApproveModalMode;
  /** releases.payment_status: при «Принять» без подтверждённой оплаты — предупреждение. */
  paymentStatus?: string | null;
  /** releases.release_date: подставляем в поле, чтобы перед отправкой ссылки сверить дату выхода. */
  releaseDate?: string | null;
  /** Уже выданная ссылка и UPC: «Изменить» открывает форму с ними, а не пустую. */
  currentLink?: string | null;
  currentUpc?: string | null;
  busy: boolean;
  onClose: () => void;
  /** Принять без ссылки. */
  onAccept: (releaseId: string) => void;
  /** Ссылка на пресейв (+ UPC по желанию): принять сразу со ссылкой или добавить к принятому. */
  /** releaseDate — только если модератор её поменял, иначе пустая строка. */
  onSubmitLink: (releaseId: string, smartLink: string, upc: string, releaseDate: string) => void;
};

function validateLink(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "Ссылка должна начинаться с http:// или https://";
    return null;
  } catch {
    return "Это не похоже на ссылку. Проверь, что скопировал её целиком.";
  }
}

export function AdminApproveSmartLinkModal({
  releaseId,
  mode,
  paymentStatus,
  releaseDate: currentReleaseDate,
  currentLink,
  currentUpc,
  busy,
  onClose,
  onAccept,
  onSubmitLink
}: Props) {
  const open = releaseId != null;
  const [smartLink, setSmartLink] = useState("");
  const [upc, setUpc] = useState("");
  const initialDate = /^\d{4}-\d{2}-\d{2}/.exec(currentReleaseDate?.trim() ?? "")?.[0] ?? "";
  const [releaseDate, setReleaseDate] = useState(initialDate);
  const [localError, setLocalError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) {
      setSmartLink(currentLink?.trim() ?? "");
      setUpc(currentUpc?.trim() ?? "");
      setReleaseDate(initialDate);
      setLocalError(null);
    }
  }, [open, releaseId, initialDate, currentLink, currentUpc]);

  const link = smartLink.trim();
  const isLinkMode = mode === "link";
  const editingLink = isLinkMode && Boolean(currentLink?.trim());
  const showUpc = isLinkMode || link.length > 0;
  const unpaidWarning = !isLinkMode && !isPaymentConfirmed(paymentStatus);

  const submit = () => {
    if (!releaseId) return;
    if (!link) {
      if (isLinkMode) {
        setLocalError("Вставь ссылку на пресейв.");
        return;
      }
      onAccept(releaseId);
      return;
    }
    const linkError = validateLink(link);
    if (linkError) {
      setLocalError(linkError);
      return;
    }
    try {
      normalizeUpc(upc);
      normalizeReleaseDate(releaseDate);
    } catch (e: unknown) {
      setLocalError(e instanceof Error ? e.message : "Проверь UPC.");
      return;
    }
    setLocalError(null);
    onSubmitLink(releaseId, link, upc, releaseDate !== initialDate ? releaseDate : "");
  };

  const primaryLabel = editingLink
    ? "Сохранить"
    : isLinkMode
    ? "Отправить"
    : unpaidWarning
      ? "Всё равно принять"
      : link
        ? "Принять со ссылкой"
        : "Принять";

  // Портал: у обёртки страницы есть transform, и `fixed` внутри неё оказывается под нижней навигацией.
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && releaseId && (
        <motion.div
          className="fixed inset-0 z-[110] flex flex-col justify-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Закрыть"
            className="absolute inset-0 bg-black/60"
            onClick={() => !busy && onClose()}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-approve-smart-title"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={SPRING_UI}
            className="relative z-10 mx-auto w-full max-w-md rounded-t-[24px] border border-b-0 border-omf-line bg-omf-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:mb-6 sm:rounded-[24px] sm:border-b"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-omf-line-strong sm:hidden" aria-hidden />
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="admin-approve-smart-title" className="text-[20px] font-bold tracking-tight">
                  {editingLink ? "Поменять ссылку" : isLinkMode ? "Ссылка на пресейв" : "Принять релиз"}
                </h2>
                <p className="mt-1 text-[14px] leading-relaxed text-omf-graphite">
                  {editingLink
                    ? "Новая ссылка сразу появится у артиста в приложении. Второго сообщения в боте не будет."
                    : isLinkMode
                    ? "Артист получит ссылку в боте и увидит её в приложении. После этого WAV удалятся из хранилища — скачай их заранее, если ещё нужны."
                    : `Артист получит сообщение, что релиз принят и ушёл на площадки (обычно ${DSP_REVIEW_DAYS_TEXT}). Ссылку добавишь позже в блоке «Ждут ссылку».`}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onClose()}
                aria-label="Закрыть"
                className="omf-focus -mr-1 rounded-full p-1.5 text-omf-graphite hover:bg-omf-surface-2 hover:text-omf-ink disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <label htmlFor="admin-smart-link" className="mt-5 block text-[13px] text-omf-graphite">
              {isLinkMode ? "Ссылка BandLink" : "Ссылка на пресейв, если уже есть"}
            </label>
            <input
              id="admin-smart-link"
              type="url"
              inputMode="url"
              autoComplete="off"
              disabled={busy}
              value={smartLink}
              onChange={(e) => {
                setSmartLink(e.target.value);
                setLocalError(null);
              }}
              placeholder="https://band.link/…"
              className="mt-2 min-h-[52px] w-full rounded-control border border-omf-line bg-omf-bg px-4 py-3 text-[16px] text-omf-ink outline-none placeholder:text-omf-faint focus:border-omf-ultra disabled:opacity-50"
            />

            {showUpc ? (
              <>
                <label htmlFor="admin-upc" className="mt-4 block text-[13px] text-omf-graphite">
                  UPC, если прислали (необязательно)
                </label>
                <input
                  id="admin-upc"
                  inputMode="numeric"
                  autoComplete="off"
                  disabled={busy}
                  value={upc}
                  onChange={(e) => {
                    setUpc(e.target.value);
                    setLocalError(null);
                  }}
                  placeholder="12 или 13 цифр"
                  className="mt-2 min-h-[52px] w-full rounded-control border border-omf-line bg-omf-bg px-4 py-3 text-[16px] tabular-nums text-omf-ink outline-none placeholder:text-omf-faint focus:border-omf-ultra disabled:opacity-50"
                />

                <label htmlFor="admin-release-date" className="mt-4 block text-[13px] text-omf-graphite">
                  {editingLink ? "Дата выхода" : "Дата выхода — придёт артисту в сообщении"}
                </label>
                <input
                  id="admin-release-date"
                  type="date"
                  disabled={busy}
                  value={releaseDate}
                  onChange={(e) => {
                    setReleaseDate(e.target.value);
                    setLocalError(null);
                  }}
                  className="mt-2 min-h-[52px] w-full rounded-control border border-omf-line bg-omf-bg px-4 py-3 text-[16px] tabular-nums text-omf-ink outline-none focus:border-omf-ultra disabled:opacity-50"
                />
                {releaseDate !== initialDate && initialDate ? (
                  <p className="mt-1.5 text-[13px] text-omf-yellow">
                    Было {formatReleaseDateDayMonthRu(initialDate)} — сохраним новую дату в релизе.
                  </p>
                ) : null}
              </>
            ) : null}

            {localError && <p className="mt-2 text-[14px] text-omf-red">{localError}</p>}

            {unpaidWarning ? (
              <p role="alert" className="mt-4 rounded-control border border-omf-yellow px-4 py-3 text-[14px] leading-relaxed">
                <span className="font-bold text-omf-yellow">Оплата не подтверждена</span>
                <span className="text-omf-graphite"> ({describePayment(paymentStatus).label}). Релиз уйдёт на площадки без оплаты.</span>
              </p>
            ) : null}

            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <button type="button" disabled={busy} onClick={() => onClose()} className="omf-btn-secondary w-full disabled:opacity-50">
                Отмена
              </button>
              <button type="button" disabled={busy} onClick={submit} className="omf-btn-primary w-full disabled:opacity-50">
                <BusyLabel busy={busy} busyText="Сохраняем…">{primaryLabel}</BusyLabel>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
