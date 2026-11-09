import type { NextStepKind } from "@/lib/release-next-step";
import { cn } from "@/lib/utils";

const STEPS = ["Отправлен", "Проверка", "Площадки", "Ссылка"] as const;

/** Какой этап сейчас идёт (индекс в STEPS) и каким цветом его показать. */
const JOURNEY: Partial<Record<NextStepKind, { current: number; tone: "wait" | "problem" | "live" }>> = {
  waiting: { current: 1, tone: "wait" },
  waiting_long: { current: 1, tone: "wait" },
  fix: { current: 1, tone: "problem" },
  approved_no_link: { current: 2, tone: "live" },
  updating: { current: 2, tone: "wait" }
};

const TONE_COLOR = {
  wait: "var(--omf-yellow)",
  problem: "var(--omf-red)",
  live: "var(--omf-green)"
} as const;

/**
 * Путь релиза в четыре этапа под статусом: что уже позади, где он сейчас и что впереди.
 * Показываем только пока релиз в пути — у черновика и вышедшего релиза линия не нужна.
 */
export function ReleaseJourney({ kind, className }: { kind: NextStepKind; className?: string }) {
  const journey = JOURNEY[kind];
  if (!journey) return null;
  const color = TONE_COLOR[journey.tone];

  return (
    <ol
      className={cn("grid grid-cols-4 gap-1.5", className)}
      aria-label={`Этап ${journey.current + 1} из ${STEPS.length}: ${STEPS[journey.current]}`}
    >
      {STEPS.map((label, i) => {
        const done = i < journey.current;
        const current = i === journey.current;
        return (
          <li key={label} className="omf-rise min-w-0" style={{ ["--i" as string]: i + 1 }} aria-current={current ? "step" : undefined}>
            <span
              className="block h-1 rounded-full"
              style={{ background: done ? "var(--omf-ink)" : current ? color : "var(--omf-line-strong)" }}
              aria-hidden
            />
            <span
              className={cn(
                "mt-2 flex items-center gap-1.5 truncate text-[12px] leading-none",
                done ? "text-omf-graphite" : current ? "font-medium text-omf-ink" : "text-omf-faint"
              )}
            >
              {current ? (
                <span
                  className={cn("h-1.5 w-1.5 shrink-0 rounded-full", journey.tone !== "problem" && "omf-step-pulse")}
                  style={{ background: color, color }}
                  aria-hidden
                />
              ) : null}
              <span className="truncate">{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
