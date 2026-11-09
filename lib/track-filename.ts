const MAX_FILENAME_LENGTH = 180;

/**
 * Безопасное имя файла из клиентского ввода: без путей и символов, запрещённых в ФС и заголовках.
 * Имя задаёт клиент, а попадает оно в ZIP и Content-Disposition, поэтому чистим на каждом шаге.
 */
export function sanitizeTrackFilename(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = (raw.split(/[/\\]/).pop() ?? "")
    .normalize("NFC")
    .replace(/[\p{Cc}<>:"|?*]/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  if (!cleaned) return null;

  const chars = Array.from(cleaned);
  if (chars.length <= MAX_FILENAME_LENGTH) return cleaned;
  const ext = cleaned.match(/\.[^.]{1,8}$/)?.[0] ?? "";
  return chars.slice(0, MAX_FILENAME_LENGTH - ext.length).join("") + ext;
}

function withWavExtension(name: string): string {
  return /\.wav$/i.test(name) ? name : `${name}.wav`;
}

/** Имя WAV при скачивании: как у клиента, для старых треков — по названию, иначе `fallback`. */
export function buildTrackAudioFilename(args: {
  originalFilename?: string | null;
  title?: string | null;
  fallback: string;
}): string {
  const name = sanitizeTrackFilename(args.originalFilename) ?? sanitizeTrackFilename(args.title);
  return name ? withWavExtension(name) : args.fallback;
}

/** Не даёт файлам с одинаковым именем перезаписать друг друга в ZIP. */
export function claimUniqueFilename(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n += 1) {
    candidate = `${stem} (${n})${ext}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}
