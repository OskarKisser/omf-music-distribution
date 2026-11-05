/** «Сингл» / «EP» / «Альбом» — коротко, для строк списков. */
export function releaseTypeLabel(type: unknown): string | null {
  if (type === "single") return "Сингл";
  if (type === "ep") return "EP";
  if (type === "album") return "Альбом";
  return null;
}
