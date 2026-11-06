/** Откуда открыли карточку релиза в админке: туда же и ведёт «назад». */
export type AdminReleaseFrom = "queue" | "links" | "pitching" | "history" | "catalog";

const BACK: Record<AdminReleaseFrom, { href: string; label: string }> = {
  queue: { href: "/admin", label: "Очередь" },
  links: { href: "/admin?view=links", label: "Ссылки" },
  pitching: { href: "/admin/pitching", label: "Питчинг" },
  history: { href: "/admin/history", label: "История" },
  catalog: { href: "/admin/catalog", label: "Каталог" }
};

export function parseAdminReleaseFrom(raw: string | null | undefined): AdminReleaseFrom {
  return raw && Object.prototype.hasOwnProperty.call(BACK, raw) ? (raw as AdminReleaseFrom) : "queue";
}

/** Ссылка на карточку релиза; из очереди — без параметра, это вариант по умолчанию. */
export function adminReleaseHref(releaseId: string, from: AdminReleaseFrom = "queue"): string {
  const base = `/admin/release/${encodeURIComponent(releaseId)}`;
  return from === "queue" ? base : `${base}?from=${from}`;
}

export function adminBackTarget(from: AdminReleaseFrom): { href: string; label: string } {
  return BACK[from];
}
