import type { ReactNode } from "react";

type EmptyShelfProps = {
  /** Надпись на наклейке верхнего конверта. */
  sticker: string;
  title: string;
  text: string;
  /** Что произойдёт дальше, по шагам (2–3 коротких строки). */
  steps?: string[];
  action?: ReactNode;
};

/**
 * Пустой раздел: стопка пустых конвертов с наклейкой, одна мысль и путь до первого результата.
 * Вместо голого текста — понятно, что раздел живой и что сделать, чтобы он заполнился.
 */
export function EmptyShelf({ sticker, title, text, steps, action }: EmptyShelfProps) {
  return (
    <div className="border-t border-omf-line pt-8">
      <div className="relative mx-auto h-[132px] w-[200px]" aria-hidden>
        <span
          className="omf-rise absolute left-3 top-5 h-[92px] w-[92px] -rotate-[11deg] rounded-sleeve bg-omf-surface-2"
          style={{ ["--i" as string]: 0 }}
        />
        <span
          className="omf-rise absolute right-3 top-6 h-[92px] w-[92px] rotate-[9deg] rounded-sleeve bg-[#3a2f8f]"
          style={{ ["--i" as string]: 1 }}
        />
        <span
          className="omf-rise absolute left-1/2 top-1 -ml-[52px] h-[104px] w-[104px] rounded-sleeve bg-omf-ultra shadow-[0_14px_30px_-12px_rgba(0,0,0,0.7)]"
          style={{ ["--i" as string]: 2 }}
        >
          <span className="absolute -right-4 bottom-3 rotate-[-7deg] rounded-full bg-omf-yellow px-2.5 py-1 text-[11px] font-bold lowercase leading-none text-omf-yellow-ink">
            {sticker}
          </span>
        </span>
      </div>

      <p className="mt-6 text-center text-[20px] font-bold tracking-[-0.02em]">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[34ch] text-center text-[14px] leading-relaxed text-omf-graphite">{text}</p>

      {steps && steps.length > 0 ? (
        <ol className="mt-6 rounded-control bg-omf-surface px-4">
          {steps.map((step, i) => (
            <li
              key={step}
              className="omf-rise flex items-center gap-3 border-b border-omf-line py-3 text-[14px] leading-snug last:border-b-0"
              style={{ ["--i" as string]: i + 3 }}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-omf-surface-2 text-[12px] font-semibold tabular-nums text-omf-graphite">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      ) : null}

      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
