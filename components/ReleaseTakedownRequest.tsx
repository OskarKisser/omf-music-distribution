"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { releaseApiRequest } from "@/lib/api/release-client";
import { canRequestTakedown } from "@/lib/release-takedown";
import { triggerHaptic } from "@/lib/telegram";

type Props = {
  releaseId: string;
  status: string;
  takedownRequestedAt: string | null | undefined;
  onRequested: (requestedAt: string) => void;
};

/**
 * Тихая ссылка внизу экрана релиза: попросить снять релиз с площадок.
 * Само удаление делает модератор у дистрибьютора — здесь только запрос.
 */
export function ReleaseTakedownRequest({ releaseId, status, takedownRequestedAt, onRequested }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const submit = useCallback(async () => {
    setBusy(true);
    try {
      await releaseApiRequest("/api/releases/request-takedown", {
        method: "POST",
        body: { releaseId, reason: reason.trim() || undefined }
      });
      triggerHaptic("success");
      toast.success("Запрос отправлен — модератор снимет релиз и напишет");
      onRequested(new Date().toISOString());
      setOpen(false);
    } catch (e) {
      triggerHaptic("error");
      toast.error(e instanceof Error ? e.message : "Не удалось отправить запрос");
    } finally {
      setBusy(false);
    }
  }, [releaseId, reason, onRequested]);

  if (takedownRequestedAt && status !== "removed") {
    return (
      <p className="mt-8 text-center text-[13px] leading-relaxed text-omf-graphite">
        Запрос на удаление отправлен. Модератор снимет релиз с площадок и напишет, когда готово.
      </p>
    );
  }
  if (!canRequestTakedown(status)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="omf-focus mx-auto mt-8 block rounded-full px-3 py-1 text-[13px] text-omf-faint hover:text-omf-red"
      >
        Удалить релиз с площадок
      </button>
      <BottomSheet
        open={open}
        onClose={close}
        header={(titleId) => (
          <h2 id={titleId} className="text-[17px] font-semibold tracking-[-0.02em]">
            Удалить релиз с площадок?
          </h2>
        )}
      >
        <p className="text-[14px] leading-relaxed text-omf-graphite">
          Модератор снимет релиз у всех площадок. Прослушивания и место в плейлистах пропадут, вернуть
          релиз можно будет только новой отправкой.
        </p>
        <label className="mt-4 block text-[13px] text-omf-graphite" htmlFor="takedown-reason">
          Причина (необязательно)
        </label>
        <textarea
          id="takedown-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={3}
          className="mt-1.5 w-full resize-none rounded-xl border border-omf-line bg-omf-surface px-3 py-2 text-[15px] outline-none focus:border-omf-ink"
          placeholder="Например: хочу перевыпустить с другим сведением"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="omf-btn-primary mt-4 h-[52px] w-full bg-omf-red font-medium disabled:opacity-50"
        >
          {busy ? "Отправляем…" : "Попросить удалить"}
        </button>
      </BottomSheet>
    </>
  );
}
