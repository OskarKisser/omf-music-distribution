"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { mutate } from "swr";
import { getAdminTelegramIdForUi, telegramIdsEqual } from "@/lib/admin";
import {
  acquireTelegramClosingConfirmation,
  getTelegramStartParam,
  getTelegramWebApp,
  getTelegramUserId,
  initTelegramWebApp,
  isTelegramClientShell,
  releaseTelegramClosingConfirmation
} from "@/lib/telegram";
import { releaseApiRequest } from "@/lib/api/release-client";
import { parseReferralStartParam } from "@/lib/referral";
import { widgetDeepLinkPath } from "@/lib/widget-deeplink";
import { REFERRAL_SWR_KEY } from "@/lib/hooks/useReferral";

/** Переход по ссылке из карточки — один раз за запуск, иначе «Назад» на главную снова уводил бы на релиз. */
let deepLinkUsed = false;

const REFERRAL_DONE_KEY = "omf:referral-attributed";
/** telegram-web-app.js подключается позже первого эффекта — ждём WebApp до ~10 с. */
const REFERRAL_POLL_MS = 250;
const REFERRAL_POLL_MAX = 40;

/**
 * Открыли по ссылке друга (`startapp=ref_…`) — просим сервер привязать приглашение.
 * Код сервер берёт сам из подписанного initData; здесь только решаем, стоит ли звать.
 * Флаг «готово» ставим после ответа, чтобы сбой сети не потерял приглашение.
 */
function attributeReferralOnce(): () => void {
  let timer: number | undefined;
  let tries = 0;

  const send = () => {
    void releaseApiRequest<{ ok: boolean; result: string }>("/api/referral/attribute", { method: "POST", body: {} })
      .then((res) => {
        try {
          sessionStorage.setItem(REFERRAL_DONE_KEY, "1");
        } catch {
          /* сервер идемпотентен */
        }
        // Экран-приветствие (ReferralWelcome) покажется сам, когда обновлённая сводка скажет, что скидка ждёт.
        if (res.result === "attributed") void mutate(REFERRAL_SWR_KEY);
      })
      .catch(() => {});
  };

  const tick = () => {
    if (getTelegramWebApp()) {
      if (parseReferralStartParam(getTelegramStartParam())) {
        try {
          if (sessionStorage.getItem(REFERRAL_DONE_KEY)) return;
        } catch {
          /* ignore */
        }
        send();
      }
      return;
    }
    if (++tries < REFERRAL_POLL_MAX) timer = window.setTimeout(tick, REFERRAL_POLL_MS);
  };

  tick();
  return () => window.clearTimeout(timer);
}

export function TelegramBootstrap() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    initTelegramWebApp();
    acquireTelegramClosingConfirmation();
    const stopReferral = attributeReferralOnce();
    return () => {
      stopReferral();
      releaseTelegramClosingConfirmation();
    };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      if (!isTelegramClientShell()) {
        void navigator.serviceWorker
          .getRegistrations()
          .then((regs) => {
            for (const reg of regs) {
              void reg.unregister();
            }
          })
          .catch(() => {});
      } else {
        navigator.serviceWorker
          .register("/sw-audio.js")
          .then(() => {})
          .catch((err) => {
            console.error("[SW-AUDIO] registration failed", err);
          });
      }
    }

    const startParam = getTelegramStartParam();
    const userId = getTelegramUserId();
    const adminId = getAdminTelegramIdForUi();
    const isAdmin = adminId !== null && userId !== null && telegramIdsEqual(userId, adminId);
    if (startParam === "admin" && isAdmin && pathname === "/") {
      router.replace("/admin");
    }
    // Кнопка «Открыть в приложении» в карточке бота ведёт сразу на нужный релиз.
    const deepLink = widgetDeepLinkPath(startParam, isAdmin);
    if (deepLink && pathname === "/" && !deepLinkUsed) {
      deepLinkUsed = true;
      router.replace(deepLink);
    }
  }, [pathname, router]);

  return null;
}
