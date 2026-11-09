"use client";

import { memo, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Disc3, Shield, CircleHelp, Link2, Megaphone } from "lucide-react";
import { isAdminUi, isAdminUiByWebSession } from "@/lib/admin";
import { hapticMap } from "@/lib/haptic-map";
import { useHideOnScrollDown } from "@/lib/hooks/useHideOnScrollDown";
import { initTelegramWebApp } from "@/lib/telegram";

type NavTab = {
  path: string;
  icon: LucideIcon;
  label: string;
};

function isTabActive(pathname: string, path: string): boolean {
  if (path === "/library") {
    return pathname === "/library" || pathname === "/";
  }
  return pathname === path;
}

const BottomNavInner = memo(function BottomNavInner() {
  const pathname = usePathname();
  const barVisible = useHideOnScrollDown();
  const [showAdminTab, setShowAdminTab] = useState(false);
  
  // Hooks must be called before any conditional returns
  useEffect(() => {
    initTelegramWebApp();
    setShowAdminTab(isAdminUi());
    void (async () => {
      const webAdmin = await isAdminUiByWebSession();
      if (webAdmin) setShowAdminTab(true);
    })();
  }, []);

  const tabs = useMemo<NavTab[]>(
    () => [
      { path: "/library", icon: Disc3, label: "Релизы" },
      { path: "/multi-links", icon: Link2, label: "Ссылки" },
      { path: "/pitching", icon: Megaphone, label: "Питчинг" },
      { path: "/requirements", icon: CircleHelp, label: "Помощь" },
      ...(showAdminTab ? [{ path: "/admin", icon: Shield, label: "Модерация" }] : [])
    ],
    [showAdminTab]
  );

  // Вход и мастер релиза — без меню: в мастере оно перекрывает «Дальше» и уводит посреди заполнения.
  if (pathname === "/login" || pathname?.startsWith("/create")) {
    return null;
  }

  return (
    <nav className="pointer-events-none fixed bottom-0 left-0 right-0 z-50" aria-label="Основная навигация">
      <AnimatePresence initial={false}>
        {barVisible ? (
          <motion.div
            key="bottom-nav-bar"
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 110 }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
            className="pointer-events-auto border-t border-omf-line bg-omf-bg pb-[env(safe-area-inset-bottom,0px)]"
          >
            <div className="mx-auto flex max-w-lg items-stretch justify-around px-2">
              {tabs.map((tab) => {
                const isActive = isTabActive(pathname, tab.path);
                const Icon = tab.icon;

                return (
                  <Link
                    key={tab.path}
                    href={tab.path}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => {
                      if (!isActive) hapticMap.impactLight();
                    }}
                    className={`omf-focus group relative flex min-w-0 flex-1 flex-col items-center gap-1 pb-2 pt-2 transition-colors duration-150 ${
                      isActive ? "text-omf-ink" : "text-omf-graphite hover:text-omf-ink"
                    }`}
                  >
                    <span className="relative flex h-7 w-[52px] items-center justify-center transition-transform duration-150 group-active:scale-90">
                      {isActive ? (
                        <motion.span
                          layoutId="activeTab"
                          className="absolute inset-0 rounded-full bg-omf-surface-2"
                          transition={{ type: "spring", stiffness: 500, damping: 40 }}
                          aria-hidden
                        />
                      ) : null}
                      <Icon className="relative" size={20} strokeWidth={isActive ? 2.2 : 1.8} aria-hidden />
                    </span>
                    <span className={`text-[11px] ${isActive ? "font-medium" : ""}`}>{tab.label}</span>
                  </Link>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </nav>
  );
});

export const BottomNav = BottomNavInner;
