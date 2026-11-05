import { AlertCircle, ArrowUp, Ban, Check, Clock, Pencil, Radio, type LucideIcon } from "lucide-react";
import type { NextStepKind } from "@/lib/release-next-step";
import { cn } from "@/lib/utils";

/** Путь релиза в четыре этапа (отправлен → проверка → площадки → ссылка): сколько пройдено, цвет и знак. */
const RING: Record<NextStepKind, { progress: number; color: string; Icon: LucideIcon }> = {
  finish_draft: { progress: 0, color: "var(--omf-graphite)", Icon: Pencil },
  submit: { progress: 0, color: "var(--omf-ink)", Icon: ArrowUp },
  fix: { progress: 0.5, color: "var(--omf-red)", Icon: AlertCircle },
  waiting: { progress: 0.5, color: "var(--omf-yellow)", Icon: Clock },
  waiting_long: { progress: 0.5, color: "var(--omf-yellow)", Icon: Clock },
  approved_no_link: { progress: 0.75, color: "var(--omf-green)", Icon: Radio },
  approved_link: { progress: 1, color: "var(--omf-green)", Icon: Check },
  removed: { progress: 0, color: "var(--omf-faint)", Icon: Ban },
  unknown: { progress: 0, color: "var(--omf-faint)", Icon: Clock }
};

/** Кольцо статуса: в строке библиотеки (44px) и крупно на экране релиза (52px). */
export function StatusRing({ kind, size = 44, className }: { kind: NextStepKind; size?: 44 | 52; className?: string }) {
  const { progress, color, Icon } = RING[kind];
  const stroke = size === 52 ? 3.5 : 3;
  const r = size / 2 - stroke;
  const circumference = 2 * Math.PI * r;
  const c = size / 2;
  return (
    <span
      className={cn("relative flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--omf-line-strong)" strokeWidth={stroke} />
        {progress > 0 ? (
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * progress} ${circumference}`}
          />
        ) : null}
      </svg>
      <Icon className={size === 52 ? "h-5 w-5" : "h-[17px] w-[17px]"} style={{ color }} strokeWidth={1.8} />
    </span>
  );
}
