"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  CREATE_FLOW_STEPS,
  getCreateBackPath,
  getCreateStepIndexFromPath
} from "@/lib/create-steps";
import { CreateStepTransition } from "@/features/release/createRelease/components/CreateStepTransition";
import { useCreateReleaseDraftStore } from "@/features/release/createRelease/store";
import { ReleaseSleeve } from "@/components/ReleaseSleeve";
import { useHaptics } from "@/lib/hooks/useHaptics";
import { useIsTelegramMiniApp } from "@/lib/hooks/useIsTelegramMiniApp";
import { useTelegramBackButton } from "@/lib/hooks/useTelegramBackButton";
import { getTelegramWebApp } from "@/lib/telegram";
import { cn } from "@/lib/utils";
import { trackFunnel } from "@/lib/funnel-analytics";

export function CreateShell({
  children,
  title
}: {
  children: React.ReactNode;
  title?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const haptics = useHaptics();
  const isTelegram = useIsTelegramMiniApp();

  const activeIndex = useMemo(() => getCreateStepIndexFromPath(pathname), [pathname]);
  const releaseTitle = useCreateReleaseDraftStore((st) => st.metadata.releaseTitle);
  const primaryArtist = useCreateReleaseDraftStore((st) => st.metadata.primaryArtist);
  const artworkUrl = useCreateReleaseDraftStore((st) => st.artworkUrl);
  const releaseId = useCreateReleaseDraftStore((st) => st.releaseId);
  const moderatorNotes = useCreateReleaseDraftStore((st) => st.moderatorNotes);

  /** Нативная MainButton Telegram скрыта — в мастере используются только кнопки в интерфейсе. */
  useEffect(() => {
    const btn = getTelegramWebApp()?.MainButton;
    if (!btn) return;
    try {
      btn.hide();
      btn.hideProgress?.();
    } catch {
      /* ignore */
    }
    return () => {
      try {
        btn.hide();
        btn.hideProgress?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  useTelegramBackButton(
    () => {
      haptics.impactLight();
      router.push(getCreateBackPath(pathname));
    },
    activeIndex > 0
  );

  const goBack = () => {
    haptics.impactLight();
    router.push(getCreateBackPath(pathname));
  };

  const stepKey = CREATE_FLOW_STEPS[activeIndex]?.key;
  useEffect(() => {
    if (stepKey) trackFunnel("wizard_step_view", { step: stepKey });
  }, [stepKey]);

  const stepCount = CREATE_FLOW_STEPS.length - 1;
  const isSuccess = activeIndex >= stepCount;
  const stepLabel = CREATE_FLOW_STEPS[activeIndex]?.label ?? "";

  return (
    <div
      className={cn(
        "min-h-[100dvh] text-omf-ink",
        isTelegram ? "px-1 pb-10 pt-4" : "w-full px-1 pb-16 pt-6 md:pb-20 md:pt-8"
      )}
    >
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        {!isSuccess ? (
          <header>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <button
                type="button"
                onClick={goBack}
                className="omf-focus -ml-2 inline-flex items-center gap-1.5 justify-self-start rounded-full px-2 py-1.5 text-[14px] text-omf-graphite transition-colors hover:text-omf-ink"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {activeIndex === 0 ? "Релизы" : CREATE_FLOW_STEPS[activeIndex - 1]?.label}
              </button>
              <p className="text-[14px] text-omf-graphite">
                <span className="font-semibold text-omf-ink">{stepLabel}</span> · шаг {activeIndex + 1} из {stepCount}
              </p>
              <span aria-hidden />
            </div>

            <div
              className="mt-3 flex gap-1.5"
              role="progressbar"
              aria-label="Шаги создания релиза"
              aria-valuemin={1}
              aria-valuemax={stepCount}
              aria-valuenow={activeIndex + 1}
            >
              {CREATE_FLOW_STEPS.slice(0, stepCount).map((s, i) => (
                <span
                  key={s.key}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors duration-300",
                    i <= activeIndex ? "bg-omf-ultra" : "bg-omf-surface-2"
                  )}
                />
              ))}
            </div>

            {/* Какой релиз собираем — только когда уже есть что показать (название или обложка). */}
            {releaseTitle.trim() || artworkUrl ? (
              <div className="mt-4 flex items-center gap-3">
                <div className="w-10 shrink-0">
                  <ReleaseSleeve
                    seed={releaseId ?? "new-release"}
                    title={releaseTitle.trim() || "Без названия"}
                    artist={primaryArtist.trim() || null}
                    coverUrl={artworkUrl}
                    size="thumb"
                  />
                </div>
                <p className="min-w-0 truncate text-[15px]">
                  <span className="font-semibold">{releaseTitle.trim() || "Без названия"}</span>
                  {primaryArtist.trim() ? <span className="text-omf-graphite"> · {primaryArtist.trim()}</span> : null}
                </p>
              </div>
            ) : null}

            {moderatorNotes ? (
              <aside
                role="note"
                className="mt-5 rounded-control border border-omf-red p-4"
                aria-labelledby="moderator-notes-title"
              >
                <p id="moderator-notes-title" className="text-[13px] font-bold text-omf-red">
                  Замечания модератора
                </p>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-omf-ink">
                  {moderatorNotes}
                </p>
                <p className="mt-2 text-[13px] text-omf-graphite">
                  Файлы уже загружены. Исправь нужное и отправь релиз на проверку снова.
                </p>
              </aside>
            ) : null}
          </header>
        ) : null}

        <CreateStepTransition>
          <div className="flex flex-col gap-5">
            {title ? (
              <h2 className="text-[26px] font-bold leading-tight tracking-[-0.04em] text-omf-ink">{title}</h2>
            ) : null}
            {children}
          </div>
        </CreateStepTransition>
      </div>
    </div>
  );
}
