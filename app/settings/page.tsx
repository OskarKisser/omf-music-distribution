"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { getTelegramApiAuthHeaders, getTelegramUsername } from "@/lib/telegram";
import { useReleases } from "@/lib/hooks/useReleases";
import { pickHeroArtistName } from "@/lib/artist-name";
import { toast } from "sonner";
import { useIsTelegramMiniApp } from "@/lib/hooks/useIsTelegramMiniApp";
import { useLogout, useWebAuth } from "@/lib/hooks/useWebAuth";
import type { UserPreferences } from "@/app/api/settings/preferences/route";
import { ReferralCard } from "@/components/ReferralCard";
import { pluralRu } from "@/lib/release-next-step";

// ─── Fetcher ──────────────────────────────────────────────────────────────────

async function fetchPreferences(): Promise<UserPreferences> {
  const res = await fetch("/api/settings/preferences", {
    headers: getTelegramApiAuthHeaders()
  });
  const json: unknown = await res.json();
  if (!res.ok || typeof json !== "object" || json === null || !("preferences" in json)) {
    throw new Error("Не удалось загрузить настройки.");
  }
  return (json as { preferences: UserPreferences }).preferences;
}

async function savePreferences(
  patch: Partial<Omit<UserPreferences, "user_id" | "updated_at">>
): Promise<UserPreferences> {
  const res = await fetch("/api/settings/preferences", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getTelegramApiAuthHeaders()
    },
    body: JSON.stringify(patch)
  });
  const json: unknown = await res.json();
  if (!res.ok || typeof json !== "object" || json === null || !("preferences" in json)) {
    throw new Error("Не удалось сохранить настройки.");
  }
  return (json as { preferences: UserPreferences }).preferences;
}

// ─── Toggle row ───────────────────────────────────────────────────────────────

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex w-full items-center justify-between gap-4 border-b border-omf-line py-3.5">
      <div className="min-w-0">
        <p className="text-[15px] text-omf-ink">{label}</p>
        {hint ? <p className="mt-0.5 text-[13px] text-omf-graphite">{hint}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`omf-focus relative inline-flex h-8 w-[52px] shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          checked ? "bg-omf-green" : "bg-omf-line-strong"
        }`}
      >
        <span
          className={`inline-block h-6 w-6 rounded-full bg-white transition-transform ${
            checked ? "translate-x-[25px]" : "translate-x-[3px]"
          }`}
        />
      </button>
    </div>
  );
}

const NOTIFY_ROWS = [
  { key: "push_notifications", label: "Решение модератора", hint: "Принят релиз или нужно что-то поправить" },
  { key: "notify_draft_reminder", label: "Напоминание о черновике", hint: "Если релиз начат и не отправлен" },
  { key: "notify_release_day", label: "День выхода релиза", hint: "Поздравим и пришлём ссылку" }
] as const;

type NotifyKey = (typeof NOTIFY_ROWS)[number]["key"];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const isTelegramContext = useIsTelegramMiniApp();
  const { releases, greetingName } = useReleases();
  const webUser = useWebAuth();
  const artistName = pickHeroArtistName(releases, greetingName);
  const tgUsername = isTelegramContext ? getTelegramUsername() : null;
  const accountLine = tgUsername ? `@${tgUsername}` : (webUser?.email ?? null);
  const {
    data: prefs,
    isLoading,
    mutate
  } = useSWR(isTelegramContext ? "settings-preferences" : null, fetchPreferences, {
    revalidateOnFocus: false
  });

  const [savingKey, setSavingKey] = useState<NotifyKey | null>(null);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleToggle = useCallback(
    async (key: NotifyKey, value: boolean) => {
      setSavingKey(key);
      try {
        const updated = await savePreferences({ [key]: value });
        await mutate(updated, { revalidate: false });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось сохранить. Попробуй ещё раз.");
      } finally {
        setSavingKey(null);
      }
    },
    [mutate]
  );

  const total = releases.length;
  const live = releases.filter((r) => r.status === "ready").length;
  const inReview = releases.filter((r) => r.status === "processing").length;

  // ─── Render ─────────────────────────────────────────────────────────────────

  const initial = (artistName.trim().charAt(0) || "•").toUpperCase();

  return (
    <div className="mx-auto w-full max-w-lg px-1 pb-40 pt-4 text-omf-ink">
      <button
        type="button"
        onClick={() => router.back()}
        className="omf-focus -ml-2 inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[14px] text-omf-graphite transition-colors hover:text-omf-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Релизы
      </button>

      <header className="mt-4 flex items-center gap-3.5">
        <span
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-omf-ultra text-[26px] font-bold text-white"
          aria-hidden
        >
          {initial}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-[28px] font-bold leading-none tracking-[-0.045em]">{artistName}</h1>
          {accountLine ? <p className="mt-1.5 truncate text-[13px] text-omf-graphite">{accountLine}</p> : null}
        </div>
      </header>

      {total > 0 ? (
        <dl className="mt-6 grid grid-cols-3 rounded-[18px] bg-omf-surface px-4 py-3.5">
          {[
            [total, pluralRu(total, ["релиз", "релиза", "релизов"])],
            [live, "на площадках"],
            [inReview, "на проверке"]
          ].map(([n, label]) => (
            <div key={String(label)} className="min-w-0">
              <dt className="sr-only">{label}</dt>
              <dd>
                <span className="block text-[22px] font-bold leading-none tracking-[-0.03em] tabular-nums">{n}</span>
                <span className="mt-1.5 block text-[13px] leading-tight text-omf-graphite">{label}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <section className="mt-7" aria-labelledby="notify-title">
        <h2 id="notify-title" className="text-[14px] font-semibold text-omf-graphite">
          Уведомления в Telegram
        </h2>
        {!isTelegramContext ? (
          <p className="border-b border-omf-line py-4 text-[14px] text-omf-graphite">
            В веб-версии новое видно по метке «Новое» в релизах. Сообщения приходят, когда входишь через Telegram.
          </p>
        ) : isLoading ? (
          <div aria-busy="true">
            {NOTIFY_ROWS.map((r) => (
              <div key={r.key} className="flex items-center justify-between border-b border-omf-line py-4">
                <div className="h-4 w-44 animate-pulse rounded bg-omf-surface" />
                <div className="h-8 w-[52px] animate-pulse rounded-full bg-omf-surface" />
              </div>
            ))}
          </div>
        ) : (
          NOTIFY_ROWS.map((r) => (
            <ToggleRow
              key={r.key}
              label={r.label}
              hint={r.hint}
              checked={prefs?.[r.key] ?? true}
              onChange={(v) => void handleToggle(r.key, v)}
              disabled={savingKey === r.key}
            />
          ))
        )}
      </section>

      {isTelegramContext ? (
        <div className="mt-7">
          <ReferralCard />
        </div>
      ) : null}

      <section className="mt-7" aria-labelledby="more-title">
        <h2 id="more-title" className="text-[14px] font-semibold text-omf-graphite">
          Ещё
        </h2>
        <Link
          href="/requirements"
          className="omf-focus flex items-center justify-between gap-4 border-b border-omf-line py-4 text-[15px] text-omf-ink"
        >
          Помощь и правила
          <ChevronRight className="h-4 w-4 text-omf-faint" aria-hidden />
        </Link>
      </section>

      <WebLogoutButton />
    </div>
  );
}

function WebLogoutButton() {
  const webUser = useWebAuth();
  const { logout } = useLogout();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Показываем только для веб-пользователей (не в Telegram)
  if (typeof window === "undefined") return null;
  if (window.Telegram?.WebApp?.initData) return null;
  if (!webUser) return null;

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logout();
    } catch (err) {
      console.error("Logout error:", err);
      toast.error("Не получилось выйти. Попробуй ещё раз.");
      setIsLoggingOut(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isLoggingOut}
      className="omf-focus mt-6 w-full rounded-control py-3 text-[15px] text-omf-red disabled:opacity-50"
    >
      {isLoggingOut ? "Выходим…" : "Выйти из аккаунта"}
    </button>
  );
}
