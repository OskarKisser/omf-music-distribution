"use client";

import { useState } from "react";
import Link from "next/link";
import { ReleaseSleeve } from "@/components/ReleaseSleeve";
import { hapticMap } from "@/lib/haptic-map";
import { adminReleaseHref } from "@/lib/admin-nav";
import { formatAgoRu } from "@/lib/admin-release-metadata";
import { DSP_REVIEW_DAYS_TEXT } from "@/lib/release-next-step";
import { cn } from "@/lib/utils";
import type { AdminAwaitingLinkRelease } from "@/types/admin";
import { formatReleaseDateDayMonthRu } from "@/lib/admin-release-publish";

const COLLAPSED_COUNT = 5;

/** Принятые релизы без ссылки на пресейв: дольше всех ждущие сверху. */
export function AdminAwaitingLinkList({
  rows,
  onAddLink,
  asTab = false
}: {
  rows: AdminAwaitingLinkRelease[];
  onAddLink: (releaseId: string) => void;
  /** Отдельная вкладка «Ждут ссылку»: без своего заголовка и без сворачивания. */
  asTab?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;
  // Во вкладке — по ближайшей дате выхода: ссылка нужнее тем, кто выходит раньше. Без даты — в конце.
  const ordered = asTab
    ? [...rows].sort((a, b) => (a.release_date ?? "9999").localeCompare(b.release_date ?? "9999"))
    : rows;
  const visible = expanded || asTab ? ordered : ordered.slice(0, COLLAPSED_COUNT);

  return (
    <section className={asTab ? undefined : "mt-10"} aria-label="Ждут ссылку">
      {asTab ? null : (
        <h2 className="text-[15px] font-bold tracking-tight">Ждут ссылку: {rows.length}</h2>
      )}
      <p className={cn("text-[13px] leading-snug text-omf-graphite", asTab ? "" : "mt-0.5")}>
        Когда площадки выдадут UPC, сделай ссылку BandLink и добавь её сюда. Обычно {DSP_REVIEW_DAYS_TEXT}.
        {asTab ? " Ближайшие релизы сверху." : ""}
      </p>
      <ul className="mt-2 flex flex-col">
        {visible.map((r) => (
          <li key={r.id} className="flex items-center gap-3 border-b border-omf-line py-3">
            <Link
              href={adminReleaseHref(r.id, asTab ? "links" : "queue")}
              className="omf-focus flex min-w-0 flex-1 items-center gap-3 rounded-[10px]"
            >
              <div className="w-14 shrink-0">
                <ReleaseSleeve seed={r.id} title={r.title} artist={r.artist_name} coverUrl={r.artwork_url} size="thumb" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-bold leading-tight tracking-[-0.01em]">{r.title}</p>
                <p className="mt-0.5 truncate text-[13px] text-omf-graphite">{r.artist_name}</p>
                <p className="mt-0.5 text-[12px] text-omf-faint">
                  принят {formatAgoRu(r.accepted_at)}
                  {r.release_date ? ` · выход ${formatReleaseDateDayMonthRu(r.release_date) ?? r.release_date}` : ""}
                  {r.upc ? ` · UPC ${r.upc}` : ""}
                </p>
              </div>
            </Link>
            <button
              type="button"
              onClick={() => {
                hapticMap.impactLight();
                onAddLink(r.id);
              }}
              className="omf-btn-secondary h-9 min-h-0 shrink-0 rounded-[10px] px-3.5 text-[13px] font-semibold"
            >
              Добавить
            </button>
          </li>
        ))}
      </ul>
      {!asTab && rows.length > COLLAPSED_COUNT ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="omf-focus mt-2 rounded-full py-1.5 text-[14px] text-omf-ultra-text hover:text-omf-ink"
        >
          {expanded ? "Свернуть" : `Показать все (${rows.length})`}
        </button>
      ) : null}
    </section>
  );
}
