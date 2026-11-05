"use client";

import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { markPlatformIssue, resolvePlatformIssue } from "@/features/admin/actions";
import {
  PLATFORM_ISSUE_PLATFORMS,
  PLATFORM_ISSUE_REASONS,
  formatPlatforms,
  platformIssueMessage,
  readPlatformIssue,
  type PlatformIssuePlatform,
  type PlatformIssueReason
} from "@/lib/platform-issue";
import { triggerHaptic } from "@/lib/telegram";
import { cn } from "@/lib/utils";
import type { ReleaseRecord } from "@/repositories/releases.repo";

type IssueFields = Pick<
  ReleaseRecord,
  "platform_issue_platforms" | "platform_issue_reasons" | "platform_issue_note" | "platform_issue_at"
>;

type Props = {
  release: Pick<ReleaseRecord, "id" | "status"> & IssueFields;
  title: string;
  /** Блок вверху (проблема активна) или тихая кнопка внизу. */
  placement: "top" | "bottom";
  onChange: (fields: IssueFields) => void;
};

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Тот же текст, что уйдёт в бот, без HTML: заголовок жирным, дальше обычный текст. */
function BotPreview({ html }: { html: string }) {
  const plain = (t: string) =>
    t.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const [head = "", ...rest] = html.replace(/^🔄 /, "").split("\n\n");
  return (
    <div className="mt-3 rounded-[14px] bg-[rgba(47,63,224,0.22)] px-3.5 py-3 text-[14px] leading-snug text-omf-ink">
      <p className="font-semibold">{plain(head)}</p>
      <p className="mt-0.5">{plain(rest.join(" "))}</p>
    </div>
  );
}

function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "omf-focus h-9 rounded-full px-3.5 text-[14px] transition-colors",
        on ? "bg-omf-ink font-medium text-omf-bg" : "bg-omf-surface-2 text-omf-graphite hover:text-omf-ink"
      )}
    >
      {label}
    </button>
  );
}

/**
 * Площадка сняла вышедший релиз (Apple Music из-за обложки и т.п.): отмечаем,
 * артист видит «Обновляем на площадках» вместо «Ссылка готова». Когда вернули — снимаем отметку.
 */
export function AdminPlatformIssuePanel({ release, title, placement, onChange }: Props) {
  const issue = readPlatformIssue(release);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [platforms, setPlatforms] = useState<PlatformIssuePlatform[]>([]);
  const [reasons, setReasons] = useState<PlatformIssueReason[]>([]);
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);

  if (release.status !== "ready") return null;
  if (placement === "top" && !issue) return null;
  if (placement === "bottom" && issue) return null;

  const openSheet = () => {
    setPlatforms(issue?.platforms ?? ["apple_music", "itunes"]);
    setReasons(issue?.reasons ?? ["artwork"]);
    setNote(issue?.note ?? "");
    // Правка уже отмеченной проблемы — артисту по умолчанию не пишем второй раз.
    setNotify(!issue);
    setSheetOpen(true);
  };

  const save = async () => {
    if (platforms.length === 0) {
      toast.error("Выбери хотя бы одну площадку");
      return;
    }
    setBusy(true);
    try {
      const { at } = await markPlatformIssue(release.id, { platforms, reasons, note: note.trim(), notify });
      triggerHaptic("success");
      toast.success(notify ? "Отмечено, артисту написали" : "Сохранено");
      onChange({
        platform_issue_platforms: platforms,
        platform_issue_reasons: reasons,
        platform_issue_note: note.trim() || null,
        platform_issue_at: at
      });
      setSheetOpen(false);
    } catch (e) {
      triggerHaptic("error");
      toast.error(e instanceof Error ? e.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  const resolve = async () => {
    setBusy(true);
    try {
      await resolvePlatformIssue(release.id, true);
      triggerHaptic("success");
      toast.success("Релиз снова на всех площадках, артисту написали");
      onChange({
        platform_issue_platforms: null,
        platform_issue_reasons: null,
        platform_issue_note: null,
        platform_issue_at: null
      });
    } catch (e) {
      triggerHaptic("error");
      toast.error(e instanceof Error ? e.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  const sheet = (
    <BottomSheet
      open={sheetOpen}
      onClose={() => (busy ? undefined : setSheetOpen(false))}
      header={(id) => (
        <h2 id={id} className="text-[20px] font-bold tracking-[-0.03em]">
          Площадка сняла релиз
        </h2>
      )}
    >
      <p className="text-[13px] font-medium text-omf-graphite">Где сняли</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {PLATFORM_ISSUE_PLATFORMS.map((p) => (
          <Chip
            key={p.key}
            on={platforms.includes(p.key)}
            label={p.label}
            onClick={() => setPlatforms((v) => toggle(v, p.key))}
          />
        ))}
      </div>

      <p className="mt-5 text-[13px] font-medium text-omf-graphite">Из-за чего</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {PLATFORM_ISSUE_REASONS.map((r) => (
          <Chip key={r.key} on={reasons.includes(r.key)} label={r.label} onClick={() => setReasons((v) => toggle(v, r.key))} />
        ))}
      </div>

      <label htmlFor="platform-issue-note" className="mt-5 block text-[13px] font-medium text-omf-graphite">
        Что сделали <span className="font-normal text-omf-faint">· видно только в админке</span>
      </label>
      <textarea
        id="platform-issue-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="Например: нарушение авторских прав, новую обложку отправили дистрибьютору."
        className="omf-focus mt-2 w-full resize-none rounded-[14px] bg-omf-surface-2 px-3.5 py-3 text-[15px] leading-snug text-omf-ink placeholder:text-omf-faint"
      />

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[15px]">Написать артисту в бот</span>
        <button
          type="button"
          role="switch"
          aria-checked={notify}
          aria-label="Написать артисту в бот"
          onClick={() => setNotify((v) => !v)}
          className={cn(
            "omf-focus relative inline-flex h-8 w-[52px] shrink-0 items-center rounded-full transition-colors",
            notify ? "bg-omf-green" : "bg-omf-line-strong"
          )}
        >
          <span
            className={cn(
              "inline-block h-6 w-6 rounded-full bg-white transition-transform",
              notify ? "translate-x-[25px]" : "translate-x-[3px]"
            )}
          />
        </button>
      </div>
      {notify && platforms.length > 0 ? <BotPreview html={platformIssueMessage(title, { platforms, reasons })} /> : null}

      <button
        type="button"
        disabled={busy || platforms.length === 0}
        onClick={() => void save()}
        className="omf-btn-primary mt-5 h-[52px] w-full font-medium disabled:opacity-50"
      >
        {busy ? "Сохраняем…" : notify ? "Сохранить и написать" : "Сохранить"}
      </button>
    </BottomSheet>
  );

  if (!issue) {
    return (
      <section className="mt-2 border-t border-omf-line pt-4" aria-label="Площадка сняла релиз">
        <button
          type="button"
          onClick={openSheet}
          className="omf-focus -ml-1 inline-flex items-center gap-1.5 rounded-full px-1 py-1.5 text-[14px] text-omf-graphite hover:text-omf-ink"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Площадка сняла релиз
        </button>
        <p className="mt-0.5 text-[13px] text-omf-faint">
          Например, Apple Music снял из-за обложки. Артист увидит «Обновляем на площадках», а не «Ссылка готова».
        </p>
        {sheet}
      </section>
    );
  }

  return (
    <section
      className="mt-6 rounded-2xl bg-[rgba(245,217,10,0.09)] p-4"
      aria-label="Площадка сняла релиз"
    >
      <p className="text-[15px] font-semibold text-omf-yellow">{formatPlatforms(issue.platforms)} сняли релиз</p>
      {issue.note ? (
        <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-snug text-omf-ink">{issue.note}</p>
      ) : null}
      <p className="mt-1.5 text-[13px] text-omf-graphite">Отметил {formatDay(issue.at)} · артист видит «Обновляем на площадках»</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void resolve()}
          className="omf-btn-primary h-10 min-h-0 flex-1 bg-omf-green px-3 text-[14px] disabled:opacity-50"
        >
          {busy ? "Сохраняем…" : "Вернули на площадки"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={openSheet}
          className="omf-btn-secondary h-10 min-h-0 px-4 text-[14px]"
        >
          Изменить
        </button>
      </div>
      {sheet}
    </section>
  );
}
