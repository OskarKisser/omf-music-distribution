"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ReferralInviteLink } from "@/components/ReferralCard";
import { DSP_REVIEW_DAYS_TEXT } from "@/lib/release-next-step";
import { REFEREE_DISCOUNT_RUB, formatRub } from "@/lib/referral";
import { hapticMap } from "@/lib/haptic-map";
import { cn } from "@/lib/utils";

/** С чего начинается первый релиз. Мультисингл в данных — это EP из двух треков. */
export type FirstReleaseFormat = "single" | "multi" | "ep" | "album";

const FORMATS: { key: FirstReleaseFormat; title: string; hint: string; stack: number }[] = [
  { key: "single", title: "Сингл", hint: "Один трек", stack: 1 },
  { key: "multi", title: "Мультисингл", hint: "Два трека", stack: 2 },
  { key: "ep", title: "EP", hint: "3–6 треков", stack: 3 },
  { key: "album", title: "Альбом", hint: "7 треков и больше", stack: 4 }
];

type FirstReleaseEmptyProps = {
  artistName: string;
  /** @username в Telegram, если есть. */
  username?: string | null;
  onCreate: (format: FirstReleaseFormat) => void;
  /** Пришёл по приглашению — скидка на первый релиз ещё не использована. */
  referralDiscountPending: boolean;
  showInvite: boolean;
};

/** Сколько «пластинок» в формате: сингл — один квадрат, остальные — клетки 2×2. */
function FormatStack({ count, accent }: { count: number; accent: boolean }) {
  if (count === 1) {
    return (
      <span
        aria-hidden
        className={cn("block h-14 w-14 shrink-0 rounded-[6px]", accent ? "bg-omf-ultra" : "bg-omf-surface-2")}
      />
    );
  }
  return (
    <span aria-hidden className="grid h-14 w-14 shrink-0 grid-cols-2 gap-1">
      {Array.from({ length: 4 }, (_, i) => (
        <span
          key={i}
          className={cn("rounded-[4px]", i < count ? "bg-omf-surface-2" : "border border-dashed border-[#3a404c]")}
        />
      ))}
    </span>
  );
}

/** Первый вход: сразу спрашиваем формат — на один вопрос в анкете меньше. */
export function FirstReleaseEmpty({
  artistName,
  username,
  onCreate,
  referralDiscountPending,
  showInvite
}: FirstReleaseEmptyProps) {
  return (
    <div className="mx-auto max-w-lg">
      <Link
        href="/settings"
        onClick={() => hapticMap.impactLight()}
        aria-label={`Профиль: ${artistName}`}
        className="omf-focus inline-flex min-w-0 items-center gap-2.5 rounded-full pr-2"
      >
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-omf-ultra text-[15px] font-semibold text-white"
        >
          {(artistName.trim()[0] ?? "?").toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold text-omf-ink">{artistName}</span>
          {username ? <span className="block truncate text-[13px] text-omf-graphite">@{username}</span> : null}
        </span>
      </Link>

      <h1 className="mt-6 text-[32px] font-bold leading-none tracking-[-0.045em] text-omf-ink">Что выпускаем?</h1>
      <p className="mt-2.5 text-[15px] leading-snug text-omf-graphite">
        Выбери формат — дальше пройдём по шагам. На площадках через {DSP_REVIEW_DAYS_TEXT} после проверки.
      </p>
      {referralDiscountPending ? (
        <p className="mt-2 text-[14px] text-omf-yellow">
          −{formatRub(REFEREE_DISCOUNT_RUB)} на первый релиз по приглашению друга
        </p>
      ) : null}

      <ul className="mt-6 flex flex-col gap-2.5">
        {FORMATS.map((f, i) => (
          <li key={f.key}>
            <button
              type="button"
              onClick={() => onCreate(f.key)}
              className="omf-focus flex w-full items-center gap-4 rounded-[18px] bg-omf-surface p-4 pr-3 text-left transition-transform active:scale-[0.98]"
            >
              <FormatStack count={f.stack} accent={i === 0} />
              <span className="min-w-0 flex-1 pl-1">
                <span className="block text-[18px] font-semibold tracking-[-0.01em] text-omf-ink">{f.title}</span>
                <span className="mt-0.5 block text-[14px] text-omf-graphite">{f.hint}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-omf-faint" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-5 text-center text-[13px] text-omf-faint">Черновик сохраняется, можно закончить потом.</p>
      {showInvite ? (
        <div className="mt-2 flex justify-center">
          <ReferralInviteLink />
        </div>
      ) : null}
    </div>
  );
}
