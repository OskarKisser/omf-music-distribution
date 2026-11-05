"use client";

import { useState } from "react";
import { toast } from "sonner";
import { updateReleaseDate } from "@/features/admin/actions";
import { formatReleaseDateDayMonthRu, normalizeReleaseDate } from "@/lib/admin-release-publish";
import { triggerHaptic } from "@/lib/telegram";
import type { ReleaseRecord } from "@/repositories/releases.repo";

const pillClass =
  "omf-focus rounded-full border border-omf-line-strong px-3.5 py-2 text-[14px] text-omf-ink transition-colors hover:bg-omf-surface disabled:opacity-50";

function isoDay(v: string | null | undefined): string {
  return /^\d{4}-\d{2}-\d{2}/.exec(v?.trim() ?? "")?.[0] ?? "";
}

/**
 * Блок «Дата выхода» на странице релиза в админке: артист перенёс дату, пока релиз
 * шёл через модерацию, — правим здесь, чтобы в приложении и в сообщениях бота была новая.
 */
export function AdminReleaseDatePanel({
  release,
  onChange
}: {
  release: Pick<ReleaseRecord, "id" | "release_date">;
  onChange: (fields: Pick<ReleaseRecord, "release_date">) => void;
}) {
  const current = isoDay(release.release_date);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);

  const label = formatReleaseDateDayMonthRu(current);
  const year = current.slice(0, 4);
  const changed = value !== current;

  const save = async () => {
    try {
      normalizeReleaseDate(value);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Проверь дату.");
      return;
    }
    setBusy(true);
    try {
      const { release: rec, notified } = await updateReleaseDate(release.id, value, notify);
      onChange({ release_date: rec.release_date });
      setEditing(false);
      triggerHaptic("success");
      toast.success(
        notify
          ? notified
            ? "Дату сохранил, артисту написал"
            : "Дату сохранил. Артисту бот не написал: нет Telegram или выключены уведомления"
          : "Дату сохранил"
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить дату.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-b border-omf-line py-3" aria-labelledby="admin-release-date">
      <div className="flex items-center gap-3">
        <h2 id="admin-release-date" className="w-[72px] shrink-0 text-[14px] text-omf-graphite">
          Выход
        </h2>
        <p className="min-w-0 flex-1 text-right text-[15px] font-medium tabular-nums">
          {label ? `${label} ${year}` : "Не указана"}
        </p>
        {!editing ? (
          <button
            type="button"
            onClick={() => {
              setValue(current);
              setNotify(true);
              setEditing(true);
            }}
            className="omf-focus shrink-0 py-1 text-[14px] text-omf-ultra-text hover:text-omf-ink"
          >
            Перенести
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-3">
          <input
            type="date"
            aria-label="Новая дата выхода"
            disabled={busy}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="min-h-[52px] w-full rounded-control border border-omf-line bg-omf-bg px-4 py-3 text-[16px] tabular-nums text-omf-ink outline-none focus:border-omf-ultra disabled:opacity-50"
          />
          <label className="mt-3 flex items-center gap-2.5 text-[14px] text-omf-ink">
            <input
              type="checkbox"
              disabled={busy}
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              className="h-4 w-4 accent-omf-ultra"
            />
            Написать артисту о новой дате
          </label>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={busy} onClick={() => setEditing(false)} className={pillClass}>
              Отмена
            </button>
            <button
              type="button"
              disabled={busy || !changed || !value}
              onClick={() => void save()}
              className={pillClass + " border-omf-ink font-bold"}
            >
              {busy ? "Сохраняем…" : "Сохранить"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
