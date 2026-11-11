/**
 * Ссылки из карточек бота в мини-приложение: `startapp=r_<id>` — релиз артиста,
 * `startapp=a_<id>` — релиз в админке. Доступ к экрану всё равно проверяет сам экран и API.
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RE = new RegExp(`^([ra])_(${UUID})$`, "i");

export function widgetDeepLinkPath(startParam: string | null | undefined, isAdmin: boolean): string | null {
  const m = RE.exec(startParam?.trim() ?? "");
  if (!m) return null;
  const id = m[2].toLowerCase();
  if (m[1].toLowerCase() === "r") return `/release/${id}`;
  return isAdmin ? `/admin/release/${id}` : null;
}
