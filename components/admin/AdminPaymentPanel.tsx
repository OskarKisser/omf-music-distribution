"use client";

import { useState } from "react";
import { toast } from "sonner";
import { remindArtistToPay, setReleaseReferralPayout, updateReleasePayment } from "@/features/admin/actions";
import {
  describePayment,
  describePaymentUpdate,
  parsePaymentStatus,
  type PaymentTone
} from "@/lib/release-payment";
import { formatRub } from "@/lib/referral";
import type { ReleaseReferral } from "@/lib/server/referrals";
import { triggerHaptic } from "@/lib/telegram";
import type { ReleaseRecord } from "@/repositories/releases.repo";

type PaymentFields = Pick<ReleaseRecord, "payment_status" | "payment_updated_at" | "payment_updated_by">;

const TONE_CLASS: Record<PaymentTone, string> = {
  done: "text-omf-green",
  wait: "text-omf-yellow",
  problem: "text-omf-red",
  muted: "text-omf-graphite"
};

function hintFor(release: PaymentFields): string | null {
  switch (parsePaymentStatus(release.payment_status)) {
    case "awaiting":
      return "Бот спросил тебя в Telegram. Нажми кнопку там или отметь оплату здесь.";
    case "unpaid":
      return "Клиенту бот сам ничего не пишет. Попроси оплатить кнопкой ниже или напиши ему сам.";
    case "not_client":
      return "Клиент не от студии: напиши ему сам — откуда узнал о нас и сколько стоит выпуск.";
    case "paid":
      return null;
    default:
      return "Оплату по этому релизу ещё не спрашивали.";
  }
}

const pillClass =
  "omf-focus rounded-full border border-omf-line-strong px-3.5 py-2 text-[14px] text-omf-ink transition-colors hover:bg-omf-surface disabled:opacity-50";

/** Блок «Оплата» на странице релиза в админке. */
export function AdminPaymentPanel({
  release,
  referral,
  onChange,
  onReferralChange
}: {
  release: Pick<ReleaseRecord, "id"> & PaymentFields;
  referral?: ReleaseReferral | null;
  onChange: (fields: PaymentFields) => void;
  onReferralChange?: (referral: ReleaseReferral | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [reminded, setReminded] = useState(false);
  const status = parsePaymentStatus(release.payment_status);
  const { label, tone } = describePayment(release.payment_status);
  const updated = describePaymentUpdate(release.payment_updated_by, release.payment_updated_at);
  const hint = hintFor(release);
  // «Оплачено» — обычное состояние: кнопки смены прячем за «Изменить».
  const [actionsOpen, setActionsOpen] = useState(false);

  const run = async (action: "paid" | "unpaid" | "ask_bot") => {
    setBusy(true);
    try {
      const fields = await updateReleasePayment(release.id, action);
      onChange(fields);
      triggerHaptic("success");
      toast.success(
        action === "ask_bot"
          ? "Вопрос про оплату отправил тебе в бот"
          : action === "paid"
            ? "Отметили оплату"
            : "Отметили: не оплачено"
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить оплату.");
    } finally {
      setBusy(false);
    }
  };

  const setPayout = async (paid: boolean) => {
    setBusy(true);
    try {
      onReferralChange?.(await setReleaseReferralPayout(release.id, paid));
      triggerHaptic("success");
      toast.success(paid ? "Записал: выплачено" : "Вернул в «к выплате»");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить выплату.");
    } finally {
      setBusy(false);
    }
  };

  const remind = async () => {
    setBusy(true);
    try {
      await remindArtistToPay(release.id);
      setReminded(true);
      triggerHaptic("success");
      toast.success("Бот попросил клиента оплатить и скинуть чек");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Не удалось написать клиенту.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-b border-omf-line py-3" aria-labelledby="admin-payment">
      <div className="flex items-center gap-3">
        <h2 id="admin-payment" className="w-[72px] shrink-0 text-[14px] text-omf-graphite">
          Оплата
        </h2>
        <p className={`min-w-0 flex-1 text-right text-[15px] font-medium first-letter:uppercase ${TONE_CLASS[tone]}`}>
          {label}
        </p>
        {status === "paid" ? (
          <button
            type="button"
            aria-expanded={actionsOpen}
            onClick={() => setActionsOpen((v) => !v)}
            className="omf-focus shrink-0 py-1 text-[14px] text-omf-ultra-text hover:text-omf-ink"
          >
            {actionsOpen ? "Скрыть" : "Изменить"}
          </button>
        ) : null}
      </div>
      {updated && (actionsOpen || status !== "paid") ? <p className="mt-1 text-right text-[12px] text-omf-faint">{updated}</p> : null}
      {hint ? <p className="mt-1 text-[13px] leading-snug text-omf-graphite">{hint}</p> : null}
      {referral?.discountRub != null ? (
        <p className="mt-3 rounded-control bg-omf-yellow px-3 py-2 text-[14px] font-bold text-omf-yellow-ink">
          🎁 Пришёл по приглашению от {referral.referrerLabel}: возьми с клиента на {formatRub(referral.discountRub)}{" "}
          меньше
        </p>
      ) : null}
      {referral?.payout ? (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-omf-line pt-3">
          <p className="min-w-0 text-[14px] leading-snug text-omf-ink">
            {referral.payout.status === "done" ? "✅ Выплачено" : "Выплати"} {formatRub(referral.payout.amountRub)}{" "}
            {referral.referrerLabel} за приглашение
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void setPayout(referral.payout?.status !== "done")}
            className={pillClass + " shrink-0"}
          >
            {referral.payout.status === "done" ? "Отменить" : "Выплатил"}
          </button>
        </div>
      ) : null}
      {status !== "paid" || actionsOpen ? (
      <div className="mt-3 flex flex-wrap gap-2">
        {status !== "paid" ? (
          <button type="button" disabled={busy} onClick={() => void run("paid")} className={pillClass}>
            Оплачено
          </button>
        ) : null}
        {status !== "unpaid" ? (
          <button type="button" disabled={busy} onClick={() => void run("unpaid")} className={pillClass}>
            Не оплачено
          </button>
        ) : null}
        {status === "unpaid" ? (
          <button type="button" disabled={busy || reminded} onClick={() => void remind()} className={pillClass}>
            {reminded ? "Клиенту написали" : "Попросить клиента оплатить"}
          </button>
        ) : null}
        {status == null || status === "awaiting" ? (
          <button type="button" disabled={busy} onClick={() => void run("ask_bot")} className={pillClass}>
            {status === "awaiting" ? "Напомнить мне в боте ещё раз" : "Напомнить мне в боте"}
          </button>
        ) : null}
      </div>
      ) : null}
    </section>
  );
}
