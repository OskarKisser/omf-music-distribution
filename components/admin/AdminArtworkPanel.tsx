"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { replaceReleaseArtwork } from "@/features/admin/actions";
import { triggerHaptic } from "@/lib/telegram";
import { RELEASE_FILE_LIMITS } from "@/repositories/releases/types";
import type { ReleaseRecord } from "@/repositories/releases.repo";

function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
}

function readSquare(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не получилось открыть картинку."));
    };
    img.src = url;
  });
}

/** Строка «Обложка · Заменить»: новая обложка после выпуска, например по требованию площадки. */
export function AdminArtworkPanel({
  release,
  onChange
}: {
  release: Pick<ReleaseRecord, "id" | "artwork_replaced_at">;
  onChange: (fields: Pick<ReleaseRecord, "artwork_url" | "artwork_replaced_at">) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const replacedDay = formatDay(release.artwork_replaced_at);

  const handleFile = async (file: File) => {
    const isImage = /^image\/(jpeg|png)$/.test(file.type) || /\.(jpe?g|png)$/i.test(file.name);
    if (!isImage) {
      toast.error("Нужна обложка в JPG или PNG");
      return;
    }
    if (file.size > RELEASE_FILE_LIMITS.artworkMaxMb * 1024 * 1024) {
      toast.error(`Обложка больше ${RELEASE_FILE_LIMITS.artworkMaxMb} МБ`);
      return;
    }
    setBusy(true);
    try {
      const { width, height } = await readSquare(file);
      if (width !== height) throw new Error(`Обложка не квадратная (${width}×${height})`);
      const { artworkUrl, replacedAt } = await replaceReleaseArtwork(release.id, file);
      triggerHaptic("success");
      toast.success("Обложка заменена");
      onChange({ artwork_url: artworkUrl, artwork_replaced_at: replacedAt });
    } catch (e) {
      triggerHaptic("error");
      toast.error(e instanceof Error ? e.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-b border-omf-line py-3" aria-labelledby="admin-artwork">
      <div className="flex items-center gap-3">
        <h2 id="admin-artwork" className="w-[72px] shrink-0 text-[14px] text-omf-graphite">
          Обложка
        </h2>
        <p className="min-w-0 flex-1 text-right text-[15px] font-medium">
          {busy ? "Загружаем…" : replacedDay ? `новая · ${replacedDay}` : "от артиста"}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="omf-focus shrink-0 py-1 text-[14px] text-omf-ultra-text hover:text-omf-ink disabled:opacity-50"
        >
          Заменить
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleFile(file);
          }}
        />
      </div>
    </section>
  );
}
