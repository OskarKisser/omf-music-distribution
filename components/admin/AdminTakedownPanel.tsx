"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import { confirmReleaseTakedown } from "@/features/admin/actions";
import { canConfirmTakedown } from "@/lib/release-takedown";
import { triggerHaptic } from "@/lib/telegram";
import type { ReleaseRecord } from "@/repositories/releases.repo";

/**
 * Снятие релиза с площадок. Если артист попросил — яркий блок вверху с причиной;
 * иначе тихая кнопка (артист попросил в личке). Подтверждаем вторым нажатием.
 */
export function AdminTakedownPanel({
  release,
  onChange
}: {
  release: Pick<ReleaseRecord, "id" | "status" | "takedown_requested_at" | "takedown_reason">;
  onChange: (fields: Pick<ReleaseRecord, "status">) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const requested = Boolean(release.takedown_requested_at);

  if (release.status === "removed") {
    return (
      <section className="mt-2 border-t border-omf-line pt-4" aria-label="Удалён с площадок">
        <p className="text-[14px] text-omf-graphite">Релиз удалён с площадок, артисту написали.</p>
      </section>
    );
  }
  if (!canConfirmTakedown(release.status)) return null;

  const confirm = async () => {
    setBusy(true);
    try {
      await confirmReleaseTakedown(release.id);
      triggerHaptic("success");
      toast.success("Отмечено: релиз удалён, артисту написали");
      onChange({ status: "removed" });
    } catch (e) {
      triggerHaptic("error");
      toast.error(e instanceof Error ? e.message : "Не получилось");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const button = confirming ? (
    <div className="mt-3 flex gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void confirm()}
        className="omf-btn-primary h-11 flex-1 bg-omf-red text-[14px] disabled:opacity-50"
      >
        {busy ? "Сохраняем…" : "Да, снят — написать артисту"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setConfirming(false)}
        className="omf-btn-secondary h-11 px-4 text-[14px]"
      >
        Отмена
      </button>
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className={
        requested
          ? "omf-btn-primary mt-3 h-11 w-full gap-2 bg-omf-red text-[14px]"
          : "omf-focus -ml-1 mt-1 inline-flex items-center gap-1.5 rounded-full px-1 py-1.5 text-[14px] text-omf-graphite hover:text-omf-ink"
      }
    >
      <Ban className="h-4 w-4" aria-hidden />
      Релиз снят с площадок
    </button>
  );

  if (!requested) {
    return (
      <section className="mt-2 border-t border-omf-line pt-4" aria-label="Снятие с площадок">
        {button}
        <p className="mt-0.5 text-[13px] text-omf-faint">
          Если артист попросил снять релиз в личке: сначала сними у дистрибьютора, потом нажми.
        </p>
      </section>
    );
  }

  return (
    <section
      className="mb-4 rounded-2xl border border-omf-red/40 bg-omf-red/10 p-4"
      aria-label="Артист просит удалить релиз"
    >
      <p className="text-[15px] font-semibold">Артист просит удалить релиз с площадок</p>
      {release.takedown_reason?.trim() ? (
        <p className="mt-1 text-[14px] text-omf-graphite">Причина: {release.takedown_reason.trim()}</p>
      ) : null}
      <p className="mt-1 text-[13px] text-omf-faint">Сними релиз у дистрибьютора, потом отметь здесь.</p>
      {button}
    </section>
  );
}
