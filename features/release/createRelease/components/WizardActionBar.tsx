"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useKeyboardVisible } from "@/hooks/useKeyboardVisible";

/**
 * Главная кнопка шага, закреплённая внизу экрана. Портал в body: шаги мастера живут внутри
 * анимаций с transform, а fixed внутри transform держится за анимацию, а не за экран.
 * Под ней на странице уже есть запас (paddingBottom у #app-main-scroll).
 * Пока открыта клавиатура, кнопка прячется: иначе WebView поднимает её над клавиатурой и она закрывает поля.
 */
export function WizardActionBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const keyboardOpen = useKeyboardVisible();

  return (
    <>
      {/* Запас в конце страницы, чтобы последнее поле не уходило под закреплённую кнопку. */}
      <div aria-hidden className={note ? "h-32" : "h-24"} />
      {mounted && !keyboardOpen
        ? createPortal(
            <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center">
              <div
                className="pointer-events-auto w-full max-w-lg border-t border-omf-line bg-omf-bg px-4 pt-3"
                style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)" }}
              >
                {children}
                {note ? <p className="mt-2 text-center text-[13px] text-omf-graphite">{note}</p> : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
