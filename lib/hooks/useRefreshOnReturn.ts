"use client";

import { useEffect, useRef } from "react";

type TelegramEvents = {
  onEvent?: (event: string, cb: () => void) => void;
  offEvent?: (event: string, cb: () => void) => void;
};

/**
 * Вызывает `onReturn`, когда пользователь вернулся в приложение: вкладка снова видима,
 * окно получило фокус или Telegram развернул свёрнутый мини-апп (`activated`).
 * Telegram на macOS держит webview живым часами, а SWR без фокуса не опрашивает —
 * без этого админка показывала вчерашнюю очередь.
 */
export function useRefreshOnReturn(onReturn: () => void, minGapMs = 3000): void {
  const ref = useRef(onReturn);
  ref.current = onReturn;

  useEffect(() => {
    let last = 0;
    const fire = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - last < minGapMs) return;
      last = now;
      ref.current();
    };
    const tg = (window as unknown as { Telegram?: { WebApp?: TelegramEvents } }).Telegram?.WebApp;
    document.addEventListener("visibilitychange", fire);
    window.addEventListener("focus", fire);
    window.addEventListener("pageshow", fire);
    tg?.onEvent?.("activated", fire);
    return () => {
      document.removeEventListener("visibilitychange", fire);
      window.removeEventListener("focus", fire);
      window.removeEventListener("pageshow", fire);
      tg?.offEvent?.("activated", fire);
    };
  }, [minGapMs]);
}
