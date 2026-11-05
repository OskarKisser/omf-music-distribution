"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, ClipboardCopy, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { buildColleagueReleaseForm, type AdminReleaseRow } from "@/lib/admin-release-metadata";
import { triggerHaptic } from "@/lib/telegram";
import { sendReleaseToColleagues } from "@/features/admin/actions";
import type { ReleaseRecord, ReleaseTrackRow } from "@/repositories/releases/types";

function formatSentAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/**
 * «Форма релиза» для рабочего чата: одной кнопкой бот шлёт форму, обложку, тексты и архив в чат коллег.
 * Копирование оставлено запасным путём (другой чат, чат не настроен).
 */
export function AdminColleagueFormCopy({
  release,
  tracks
}: {
  release: ReleaseRecord;
  tracks: ReleaseTrackRow[];
}) {
  const text = useMemo(
    () => buildColleagueReleaseForm(release as AdminReleaseRow, tracks),
    [release, tracks]
  );
  const missing = useMemo(
    () => new Set(text.split("\n").filter((l) => /^[\d.]+ .+: —$/.test(l))).size,
    [text]
  );
  const [done, setDone] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(release.colleagues_sent_at ?? null);

  const onSend = useCallback(async () => {
    if (sentAt && !window.confirm("Форму уже отправляли. Отправить ещё раз?")) return;
    setSending(true);
    try {
      const res = await sendReleaseToColleagues(release.id);
      setSentAt(res.sentAt);
      triggerHaptic("success");
      toast.success("Отправлено в чат коллег");
    } catch (e) {
      triggerHaptic("error");
      toast.error(e instanceof Error ? e.message : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  }, [release.id, sentAt]);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      triggerHaptic("success");
      toast.success("Форма скопирована — вставьте в чат");
      window.setTimeout(() => setDone(false), 1600);
    } catch {
      triggerHaptic("error");
      toast.error("Не удалось скопировать");
    }
  }, [text]);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void onSend()}
        disabled={sending}
        className="omf-btn-ink w-full justify-start gap-3 px-4 text-[14px] disabled:opacity-50"
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {sending ? "Отправляем…" : "Отправить коллегам в чат"}
      </button>
      {sentAt ? (
        <p className="text-[13px] text-omf-green">Отправлено {formatSentAt(sentAt)}</p>
      ) : null}
      <button
        type="button"
        onClick={() => void onCopy()}
        className="omf-btn-secondary w-full justify-start gap-3 px-4 text-[14px]"
      >
        {done ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
        Скопировать форму для коллег
      </button>
      <p className="text-[13px] leading-relaxed text-omf-faint">
        {missing > 0
          ? `Не заполнено полей: ${missing} — в тексте стоит «—». `
          : ""}
        В чат уходят форма, обложка и тексты файлами и ссылка на архив со всеми WAV.
      </p>
    </div>
  );
}
