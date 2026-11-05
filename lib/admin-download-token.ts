import crypto from "crypto";

/** Время жизни ссылки на скачивание, секунды. */
export const ADMIN_DOWNLOAD_TTL_SECONDS = 120;
export const ADMIN_DOWNLOAD_PARAM = "dl";

/** Разрешённые пути: только скачивание файлов релиза (GET) из админ API. */
const ALLOWED_PATH =
  /^\/api\/admin\/releases\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(bundle|download)$/i;

function secret(): string | null {
  const base = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return base ? `admin-download:${base}` : null;
}

function sign(expiresAt: number, pathAndQuery: string, key: string): string {
  return crypto.createHmac("sha256", key).update(`${expiresAt}\n${pathAndQuery}`).digest("hex");
}

/** Убирает служебный параметр dl, чтобы подпись считалась по «чистому» пути. */
function canonical(pathname: string, search: URLSearchParams): string {
  const params = new URLSearchParams(search);
  params.delete(ADMIN_DOWNLOAD_PARAM);
  params.sort();
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Ссылка на архив в рабочем чате коллег: им нужно успеть скачать, не открывая админку. */
export const COLLEAGUES_DOWNLOAD_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Выдаёт путь с токеном или null, если путь не разрешён или нет секрета. */
export function createAdminDownloadPath(
  pathWithQuery: string,
  now = Date.now(),
  ttlSeconds = ADMIN_DOWNLOAD_TTL_SECONDS
): string | null {
  const key = secret();
  if (!key) return null;
  let url: URL;
  try {
    url = new URL(pathWithQuery, "http://local");
  } catch {
    return null;
  }
  if (!ALLOWED_PATH.test(url.pathname)) return null;
  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  const base = canonical(url.pathname, url.searchParams);
  const token = `${expiresAt}.${sign(expiresAt, base, key)}`;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${ADMIN_DOWNLOAD_PARAM}=${token}`;
}

/** Проверяет токен из `?dl=` для данного запроса (путь и остальные параметры должны совпасть). */
export function verifyAdminDownloadUrl(requestUrl: string, now = Date.now()): boolean {
  const key = secret();
  if (!key) return false;
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return false;
  }
  if (!ALLOWED_PATH.test(url.pathname)) return false;
  const token = url.searchParams.get(ADMIN_DOWNLOAD_PARAM);
  if (!token) return false;
  const [expRaw, mac] = token.split(".");
  const expiresAt = Number(expRaw);
  if (!mac || !Number.isFinite(expiresAt)) return false;
  if (Math.floor(now / 1000) > expiresAt) return false;
  const expected = sign(expiresAt, canonical(url.pathname, url.searchParams), key);
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
