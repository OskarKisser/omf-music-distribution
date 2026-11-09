"use client";

import type { HTMLAttributes } from "react";
import { motion } from "framer-motion";

type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/**
 * Пульсирующий блок-заглушка (премиальный слой загрузки).
 */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={["rounded-lg bg-omf-surface skeleton-shimmer-bg", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

/**
 * Скелетон строки релиза: квадрат обложки + две полоски текста (как в библиотеке).
 */
export function LibraryReleaseRowSkeleton() {
  return (
    <div
      className="flex w-full items-center gap-3.5 py-2"
      aria-hidden
    >
      <Skeleton className="h-[60px] w-[60px] shrink-0 rounded-sleeve" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-[70%] max-w-[220px]" />
        <Skeleton className="h-3 w-[40%] max-w-[120px]" />
      </div>
      <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
    </div>
  );
}

/** Скелетон очереди модерации — близко к высоте карточки в AdminReleaseCard. */
export function AdminModerationQueueSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="overflow-hidden border-b border-omf-line py-4"
          aria-hidden
        >
          <div className="flex min-h-[120px] gap-3">
            <Skeleton className="h-[72px] w-[72px] shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-[88%] max-w-[260px] rounded-md" />
              <Skeleton className="h-3.5 w-[60%] max-w-[180px] rounded-md" />
              <Skeleton className="h-5 w-32 rounded-full" />
              <Skeleton className="h-3 w-full max-w-[220px] rounded-md" />
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <Skeleton className="h-3 w-24 rounded-md" />
            <Skeleton className="h-11 w-full rounded-xl" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Skeleton className="h-11 rounded-xl" />
            <Skeleton className="h-11 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

const librarySkeletonContainer = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.055, delayChildren: 0.05 }
  }
};

const librarySkeletonRow = {
  hidden: { opacity: 0.4, y: 6 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const }
  }
};

/** Три карточки статистики под шапкой библиотеки (пока SWR грузит список). */
export function LibraryStatsSkeletonRow() {
  return (
    <div className="grid grid-cols-3 gap-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-control border border-omf-line px-3 py-3"
        >
          <Skeleton className="mb-2 h-2.5 w-14 rounded" />
          <Skeleton className="h-7 w-10 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** Скелетон плитки библиотеки: квадрат конверта + две строки. */
export function LibraryReleaseTileSkeleton() {
  return (
    <div aria-hidden>
      <Skeleton className="aspect-square w-full rounded-sleeve" />
      <Skeleton className="mt-2.5 h-3.5 w-[75%] rounded" />
      <Skeleton className="mt-1.5 h-3 w-[45%] rounded" />
    </div>
  );
}

export function LibraryReleaseSkeletonGrid({
  count = 6,
  variant = "tiles"
}: {
  count?: number;
  variant?: "tiles" | "rows";
}) {
  return (
    <motion.div
      className={variant === "tiles" ? "grid grid-cols-2 gap-x-4 gap-y-7" : "grid grid-cols-1"}
      variants={librarySkeletonContainer}
      initial="hidden"
      animate="show"
    >
      {Array.from({ length: count }, (_, i) => (
        <motion.div key={i} variants={librarySkeletonRow}>
          {variant === "tiles" ? <LibraryReleaseTileSkeleton /> : <LibraryReleaseRowSkeleton />}
        </motion.div>
      ))}
    </motion.div>
  );
}
