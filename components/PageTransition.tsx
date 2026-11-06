"use client";

import { usePathname } from "next/navigation";

/**
 * Переход между разделами: новый экран сразу проявляется и чуть подъезжает (200 мс), без ожидания,
 * пока погаснет старый. CSS-анимация, а не framer: кадр с opacity 0 не может «застрять» в Safari,
 * при `prefers-reduced-motion` движения нет (см. `.omf-page-enter` в globals.css).
 * `/create/*` — без перехода: там свой слайд шагов в `CreateShell`.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const animate = !pathname.startsWith("/create");

  return (
    <div
      key={pathname}
      className={`relative min-h-app w-full min-w-0 overflow-x-hidden${animate ? " omf-page-enter" : ""}`}
    >
      {children}
    </div>
  );
}
