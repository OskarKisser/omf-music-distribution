"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { hapticMap } from "@/lib/haptic-map";
import { cn } from "@/lib/utils";

export type AdminTab = "queue" | "links" | "pitching" | "history" | "catalog";

const TABS: { key: AdminTab; label: string; href: string }[] = [
  { key: "queue", label: "Очередь", href: "/admin" },
  { key: "links", label: "Ссылки", href: "/admin?view=links" },
  { key: "pitching", label: "Питчинг", href: "/admin/pitching" },
  { key: "history", label: "История", href: "/admin/history" },
  { key: "catalog", label: "Каталог", href: "/admin/catalog" }
];

/**
 * Разделы модерации по ходу работы: решить → дать ссылку → отправить питчинг редакциям → архив.
 * Счётчики — там, где они известны.
 */
export function AdminTabs({
  active,
  counts
}: {
  active: AdminTab;
  counts?: Partial<Record<AdminTab, number>>;
}) {
  const navRef = useRef<HTMLElement>(null);
  const countsKey = JSON.stringify(counts ?? {});
  /** Узкий экран: вкладки не влезают — затухание у края, где есть ещё. */
  const [fade, setFade] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const activeEl = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (activeEl && nav.scrollWidth > nav.clientWidth) {
      nav.scrollLeft = Math.max(0, activeEl.offsetLeft - (nav.clientWidth - activeEl.offsetWidth) / 2);
    }
    const update = () =>
      setFade({
        left: nav.scrollLeft > 2,
        right: nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2
      });
    update();
    nav.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      nav.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [active, countsKey]);

  const mask =
    fade.left || fade.right
      ? `linear-gradient(to right, ${fade.left ? "transparent, #000 24px" : "#000"}, ${fade.right ? "#000 calc(100% - 24px), transparent" : "#000"})`
      : undefined;

  return (
    <nav
      ref={navRef}
      aria-label="Разделы модерации"
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      className="-mx-1 mb-4 flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
              "omf-focus flex h-9 shrink-0 items-center gap-1 rounded-full px-2 text-[13.5px] tracking-[-0.01em] transition-colors",
              isActive ? "bg-omf-surface-2 font-medium text-omf-ink" : "text-omf-graphite hover:text-omf-ink"
            )}
          >
            {tab.label}
            {count != null && count > 0 ? (
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
