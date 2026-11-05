"use client";

import { ReleaseSleeve } from "@/components/ReleaseSleeve";
import { StatusRing } from "@/components/library/StatusRing";
import type { NextStepKind } from "@/lib/release-next-step";
import { cn } from "@/lib/utils";

export type ReleaseRowProps = {
  id: string;
  title: string;
  artist?: string | null;
  coverUrl?: string | null;
  kind: NextStepKind;
  /** Одна строка статуса под названием (цвет по смыслу). */
  statusLine: { text: string; className: string };
  priority?: boolean;
  busy?: boolean;
  /** Решение модератора, которое ещё не открывали. */
  isNew?: boolean;
  onClick: () => void;
};

/** Строка библиотеки: обложка, название, статус словом и кольцо пройденного пути. */
export function ReleaseRow({ id, title, artist, coverUrl, kind, statusLine, priority, busy, isNew, onClick }: ReleaseRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "omf-focus -mx-2 grid w-[calc(100%+16px)] grid-cols-[60px_1fr_44px] items-center gap-3.5 rounded-[14px] px-2 py-2 text-left transition-[transform,background-color] duration-150 hover:bg-omf-surface active:scale-[0.98] active:bg-omf-surface",
        busy && "opacity-60"
      )}
    >
      <span className="relative block w-[60px]">
        <ReleaseSleeve seed={id} title={title} artist={artist} coverUrl={coverUrl} size="thumb" priority={priority} />
        {isNew ? (
          <span
            className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-omf-bg bg-omf-ultra"
            aria-label="Новое решение по релизу"
          />
        ) : null}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[16px] font-semibold tracking-[-0.01em] text-omf-ink">{title}</span>
        <span className={cn("mt-0.5 block truncate text-[13px]", busy ? "text-omf-graphite" : statusLine.className)}>
          {busy ? "Открываем…" : statusLine.text}
        </span>
      </span>
      <StatusRing kind={kind} />
    </button>
  );
}
