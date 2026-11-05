"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import type { CanonicalReleaseStatus } from "@/lib/release-status";
import { cn } from "@/lib/utils";

type StickerStyle = { label: string; background?: string; color: string; border?: string; className?: string };

/** Наклейка на конверте: короткая надпись, читается с расстояния вытянутой руки. */
const STICKERS: Record<CanonicalReleaseStatus, StickerStyle | null> = {
  draft: {
    label: "черновик",
    background: "var(--omf-bg)",
    color: "var(--omf-ink)",
    border: "1.5px solid var(--omf-ink)"
  },
  pending: {
    label: "не отправлен",
    background: "var(--omf-ink)",
    color: "var(--omf-bg)"
  },
  processing: {
    label: "на проверке",
    background: "var(--omf-yellow)",
    color: "var(--omf-yellow-ink)",
    className: "omf-sticker--pulse"
  },
  ready: { label: "принят", color: "#fff", className: "omf-sticker--holo" },
  failed: { label: "отклонён", background: "var(--omf-red)", color: "#fff" },
  removed: {
    label: "удалён",
    background: "var(--omf-surface-2)",
    color: "var(--omf-graphite)",
    border: "1.5px solid var(--omf-line)"
  },
  unknown: null
};

/** Обложки без картинки: цвет конверта из фиксированного набора, выбирается по id релиза. */
const BLANK_SLEEVES: { background: string; color: string }[] = [
  { background: "var(--omf-ultra)", color: "var(--omf-ink)" },
  { background: "var(--omf-ink)", color: "var(--omf-bg)" },
  { background: "var(--omf-surface-2)", color: "var(--omf-graphite)" },
  { background: "#3a2f8f", color: "var(--omf-yellow)" }
];

const TILTS = [-9, -5, 6, 8, -7, 4];

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function getStickerLabel(status: CanonicalReleaseStatus): string | null {
  return STICKERS[status]?.label ?? null;
}

export type ReleaseSleeveProps = {
  title: string;
  artist?: string | null;
  coverUrl?: string | null;
  status?: CanonicalReleaseStatus | null;
  /** Стабильный seed (обычно id релиза) — цвет пустой обложки и наклон наклейки. */
  seed: string;
  /** tile — сетка библиотеки, thumb — строка списка, hero — крупно на экране релиза/модерации. */
  size?: "tile" | "thumb" | "hero";
  priority?: boolean;
  className?: string;
};

export function ReleaseSleeve({
  title,
  artist,
  coverUrl,
  status,
  seed,
  size = "tile",
  priority = false,
  className
}: ReleaseSleeveProps) {
  const h = hashSeed(seed);
  const blank = BLANK_SLEEVES[h % BLANK_SLEEVES.length];
  const sticker = status ? STICKERS[status] : null;
  const showSticker = sticker != null && size !== "thumb";
  const tilt = TILTS[h % TILTS.length];

  const sizes = size === "hero" ? "(max-width: 640px) 70vw, 320px" : size === "thumb" ? "56px" : "(max-width: 640px) 45vw, 240px";

  return (
    <div
      className={cn("omf-sleeve", className)}
      style={coverUrl ? undefined : { background: blank.background }}
    >
      {coverUrl ? (
        <Image
          src={coverUrl}
          alt=""
          fill
          sizes={sizes}
          priority={priority}
          unoptimized={coverUrl.startsWith("blob:") || coverUrl.startsWith("data:")}
          className="rounded-sleeve object-cover"
        />
      ) : (
        <div
          className={cn(
            "absolute inset-0 flex flex-col justify-end overflow-hidden",
            size === "hero" ? "p-4" : size === "thumb" ? "p-1.5" : "p-2.5"
          )}
          style={{ color: blank.color }}
          aria-hidden
        >
          {size === "thumb" ? (
            <span className="absolute inset-0 flex items-center justify-center text-[28px] font-extrabold leading-none">
              {(title.trim().charAt(0) || "•").toUpperCase()}
            </span>
          ) : (
            <>
              <span
                className={cn(
                  "line-clamp-3 font-extrabold leading-[0.95] tracking-[-0.03em]",
                  size === "hero" ? "text-[28px]" : "text-[15px]"
                )}
              >
                {title}
              </span>
              {artist ? (
                <span
                  className={cn(
                    "mt-1 truncate font-medium opacity-80",
                    size === "hero" ? "text-[14px]" : "text-[11px]"
                  )}
                >
                  {artist}
                </span>
              ) : null}
            </>
          )}
        </div>
      )}

      {showSticker && sticker ? (
        <span
          className={cn("omf-sticker", sticker.className)}
          style={
            {
              background: sticker.background,
              color: sticker.color,
              border: sticker.border,
              "--omf-sticker-tilt": `${tilt}deg`,
              ...(size === "hero"
                ? { width: 84, height: 84, top: -16, right: -10, fontSize: 13 }
                : null)
            } as CSSProperties
          }
        >
          {sticker.label}
        </span>
      ) : null}
    </div>
  );
}
