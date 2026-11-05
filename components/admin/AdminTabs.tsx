"use client";

import Link from "next/link";
import { hapticMap } from "@/lib/haptic-map";
import { cn } from "@/lib/utils";

export type AdminTab = "queue" | "links" | "history" | "catalog";

const TABS: { key: AdminTab; label: string; href: string }[] = [
  { key: "queue", label: "Очередь", href: "/admin" },
  { key: "links", label: "Ссылки", href: "/admin?view=links" },
  { key: "history", label: "История", href: "/admin/history" },
  { key: "catalog", label: "Каталог", href: "/admin/catalog" }
];

/** Разделы модерации вкладками вместо иконок без подписей. Счётчики — там, где они известны. */
export function AdminTabs({
  active,
  counts
}: {
  active: AdminTab;
  counts?: Partial<Record<AdminTab, number>>;
}) {
  return (
    <nav
      aria-label="Разделы модерации"
      className="-mx-1 mb-4 flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        const count = counts?.[tab.key];
        return (
          <Link
            key={tab.key}
            href={tab.href}
            replace
            aria-current={isActive ? "page" : undefined}
            onClick={() => hapticMap.impactLight()}
            className={cn(
              "omf-focus flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[14px] transition-colors",
              isActive ? "bg-omf-surface-2 font-medium text-omf-ink" : "text-omf-graphite hover:text-omf-ink"
            )}
          >
            {tab.label}
            {count != null ? (
              <span className="tabular-nums text-omf-faint">
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
