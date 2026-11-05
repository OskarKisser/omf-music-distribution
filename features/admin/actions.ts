"use client";

import type { ReleaseRecord } from "@/repositories/releases.repo";
import type { ReleaseReferral } from "@/lib/server/referrals";
import {
  getAdminTelegramIdForUi,
  getAdminApiAuthHeaders,
  isAdminUiByWebSession,
  telegramIdsEqual
} from "@/lib/admin";
import { getTelegramUserId } from "@/lib/telegram";

/**
 * В production: Telegram ID совпадает с ADMIN_TELEGRAM_ID **или** веб-сессия Supabase
 * с `public.users.role = 'admin'` (как в `requireAdminSupabaseClient` / `isAdminUiByWebSession`).
 */
async function assertAdminAsync(): Promise<void> {
  if (process.env.NODE_ENV === "development") {
    return;
  }
  const uid = getTelegramUserId();
  const adminId = getAdminTelegramIdForUi();
  if (uid != null && adminId != null && telegramIdsEqual(uid, adminId)) {
    return;
  }
  const webAdmin = await isAdminUiByWebSession();
  if (!webAdmin) {
    throw new Error("Доступ только для администратора.");
  }
}

async function postModeration(
  body: { releaseId: string; action: "approve" | "reject"; comment?: string; reasonKeys?: string[] }
): Promise<ReleaseRecord> {
  const authHeaders = await getAdminApiAuthHeaders();
  const res = await fetch("/api/admin/update-release-status", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders
    },
    body: JSON.stringify(body),
    cache: "no-store"
  });

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error("Не удалось обновить статус релиза.");
  }

  if (!res.ok) {
    const err =
      typeof json === "object" && json !== null && "error" in json && typeof (json as { error: unknown }).error === "string"
        ? (json as { error: string }).error
        : "Не удалось обновить статус релиза.";
    throw new Error(err);
  }

  const parsed = json as { ok?: boolean; record?: ReleaseRecord };
  if (parsed.ok !== true || !parsed.record) {
    throw new Error("Не удалось обновить статус релиза.");
  }

  return parsed.record;
}

/**
 * Принять релиз: статус `ready` без ссылки, `error_message` очищается. Ссылку добавляют позже.
 * Обновление через API с service role (обходит RLS Mini App клиента).
 */
export async function approveRelease(releaseId: string): Promise<ReleaseRecord> {
  await assertAdminAsync();
  return postModeration({ releaseId, action: "approve" });
}

/**
 * Отклонить релиз: статус `failed`; причина в `error_message` / `admin_notes`.
 */
export async function rejectRelease(
  releaseId: string,
  comment: string,
  reasonKeys: string[] = []
): Promise<ReleaseRecord> {
  await assertAdminAsync();
  return postModeration({
    releaseId,
    action: "reject",
    comment,
    ...(reasonKeys.length > 0 ? { reasonKeys } : {})
  });
}

async function postPublishSmartLink(body: {
  releaseId: string;
  newStatus: string;
  smartLink: string;
  upc?: string;
  releaseDate?: string;
}): Promise<ReleaseRecord> {
  const authHeaders = await getAdminApiAuthHeaders();
  const res = await fetch("/api/admin/publish-release-smart-link", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders
    },
    body: JSON.stringify(body),
    cache: "no-store"
  });

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error("Не удалось выпустить релиз со ссылкой.");
  }

  if (!res.ok) {
    const o = json as { error?: unknown; detail?: unknown };
    const base =
      typeof o.error === "string" && o.error.length > 0
        ? o.error
        : "Не удалось выпустить релиз со ссылкой.";
    const detail = typeof o.detail === "string" && o.detail.trim() ? o.detail.trim() : "";
    throw new Error(detail ? `${base} ${detail}` : base);
  }

  const parsed = json as { ok?: boolean; record?: ReleaseRecord };
  if (parsed.ok !== true || !parsed.record) {
    throw new Error("Не удалось выпустить релиз со ссылкой.");
  }

  return parsed.record;
}

/**
 * Выпуск релиза из модерации: статус `ready` в БД + `smart_link`.
 * `newStatus` с клиента обычно `RELEASED`; сервер нормализует под enum.
 */
export async function publishReleaseWithSmartLink(
  releaseId: string,
  newStatus: string,
  smartLink: string,
  upc?: string,
  /** Новая дата выхода `YYYY-MM-DD`; пусто — оставить как есть. */
  releaseDate?: string
): Promise<ReleaseRecord> {
  await assertAdminAsync();
  return postPublishSmartLink({
    releaseId,
    newStatus,
    smartLink,
    ...(upc?.trim() ? { upc: upc.trim() } : {}),
    ...(releaseDate?.trim() ? { releaseDate: releaseDate.trim() } : {})
  });
}

/** Перенести дату выхода. `notify` — написать артисту в бот. Возвращает, ушло ли сообщение. */
export async function updateReleaseDate(
  releaseId: string,
  releaseDate: string,
  notify: boolean
): Promise<{ release: ReleaseRecord; notified: boolean }> {
  await assertAdminAsync();
  const authHeaders = await getAdminApiAuthHeaders();
  const res = await fetch(`/api/admin/releases/${encodeURIComponent(releaseId)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ releaseDate, notify }),
    cache: "no-store"
  });
  type Body = { ok?: boolean; error?: string; release?: ReleaseRecord; notified?: boolean };
  let json: Body | null = null;
  try {
    json = (await res.json()) as Body;
  } catch {
    json = null;
  }
  if (!res.ok || json?.ok !== true || !json.release) {
    throw new Error(json?.error || "Не удалось сохранить дату.");
  }
  return { release: json.release, notified: json.notified === true };
}

/** Напомнить артисту через бота, что релиз не отправлен. Бросает ошибку с понятным текстом. */
export async function remindArtist(releaseId: string): Promise<void> {
  await assertAdminAsync();
  const authHeaders = await getAdminApiAuthHeaders();
  const res = await fetch("/api/admin/remind-artist", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ releaseId }),
    cache: "no-store"
  });
  let json: { ok?: boolean; error?: string } | null = null;
  try {
    json = (await res.json()) as { ok?: boolean; error?: string };
  } catch {
    json = null;
  }
  if (!res.ok || json?.ok !== true) {
    throw new Error(json?.error || "Не удалось отправить напоминание.");
  }
}

/**
 * Оплата из админки: отметить «оплачено» / «не оплачено» или ещё раз спросить админа в боте.
 * Возвращает обновлённые поля оплаты релиза.
 */
export async function updateReleasePayment(
  releaseId: string,
  action: "paid" | "unpaid" | "ask_bot"
): Promise<Pick<ReleaseRecord, "payment_status" | "payment_updated_at" | "payment_updated_by">> {
  await assertAdminAsync();
  const authHeaders = await getAdminApiAuthHeaders();
  const res = await fetch("/api/admin/release-payment", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ releaseId, action }),
    cache: "no-store"
  });
  type PaymentResponse = { ok?: boolean; error?: string; release?: Partial<ReleaseRecord> };
  let json: PaymentResponse | null = null;
  try {
    json = (await res.json()) as PaymentResponse;
  } catch {
    json = null;
  }
  if (!res.ok || json?.ok !== true || !json.release) {
    throw new Error(json?.error || "Не удалось сохранить оплату.");
  }
  return {
    payment_status: json.release.payment_status ?? null,
    payment_updated_at: json.release.payment_updated_at ?? null,
    payment_updated_by: json.release.payment_updated_by ?? null
  };
}

/** Бот просит клиента оплатить (только при «не оплачено», раз в сутки). Бросает ошибку с понятным текстом. */
export async function remindArtistToPay(releaseId: string): Promise<void> {
  await assertAdminAsync();
  const authHeaders = await getAdminApiAuthHeaders();
  const res = await fetch("/api/admin/release-payment", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ releaseId, action: "remind_artist" }),
    cache: "no-store"
  });
  let json: { ok?: boolean; error?: string } | null = null;
  try {
    json = (await res.json()) as { ok?: boolean; error?: string };
  } catch {
    json = null;
  }
  if (!res.ok || json?.ok !== true) {
    throw new Error(json?.error || "Не удалось написать клиенту.");
  }
}

/** Удалить релиз насовсем (тестовые, дубли): строка, треки и файлы. Артисту ничего не уходит. */
export async function deleteRelease(releaseId: string): Promise<void> {
  await assertAdminAsync();
  const authHeaders = await getAdminApiAuthHeaders();
  const res = await fetch(`/api/admin/releases/${encodeURIComponent(releaseId)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { Accept: "application/json", ...authHeaders },
    cache: "no-store"
  });
  let json: { ok?: boolean; error?: string } | null = null;
  try {
    json = (await res.json()) as { ok?: boolean; error?: string };
  } catch {
    json = null;
  }
  if (!res.ok || json?.ok !== true) {
    throw new Error(json?.error || "Не удалось удалить релиз.");
  }
}

/** «Выплатил» / «Вернуть в к выплате» бонуса за приглашение на странице релиза друга. */
export async function setReleaseReferralPayout(releaseId: string, paid: boolean): Promise<ReleaseReferral | null> {
  await assertAdminAsync();
  const authHeaders = await getAdminApiAuthHeaders();
  const res = await fetch("/api/admin/release-referral", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ releaseId, paid }),
    cache: "no-store"
  });
  type PayoutResponse = { ok?: boolean; error?: string; referral?: ReleaseReferral | null };
  let json: PayoutResponse | null = null;
  try {
    json = (await res.json()) as PayoutResponse;
  } catch {
    json = null;
  }
  if (!res.ok || json?.ok !== true) {
    throw new Error(json?.error || "Не удалось сохранить выплату.");
  }
  return json.referral ?? null;
}

async function postAdmin(path: string, fallbackError: string): Promise<Record<string, unknown>> {
  await assertAdminAsync();
  const authHeaders = await getAdminApiAuthHeaders();
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", ...authHeaders },
    cache: "no-store"
  });
  let json: { ok?: boolean; error?: string } & Record<string, unknown> = {};
  try {
    json = (await res.json()) as typeof json;
  } catch {
    json = {};
  }
  if (!res.ok || json.ok !== true) {
    throw new Error(json.error || fallbackError);
  }
  return json;
}

/** Релиз снят у дистрибьютора: статус «Удалён», артисту сообщение в бот. */
export async function confirmReleaseTakedown(releaseId: string): Promise<void> {
  await postAdmin(
    `/api/admin/releases/${encodeURIComponent(releaseId)}/takedown`,
    "Не удалось отметить релиз удалённым."
  );
}

/** Отправить форму релиза, обложку и архив файлов в рабочий чат коллег. */
export async function sendReleaseToColleagues(releaseId: string): Promise<{ sentAt: string }> {
  const json = await postAdmin(
    `/api/admin/releases/${encodeURIComponent(releaseId)}/send-colleagues`,
    "Не удалось отправить в чат коллег."
  );
  return { sentAt: typeof json.sentAt === "string" ? json.sentAt : new Date().toISOString() };
}

async function sendAdminJson(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
  fallbackError: string
): Promise<Record<string, unknown>> {
  await assertAdminAsync();
  const authHeaders = await getAdminApiAuthHeaders();
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  let json: { ok?: boolean; error?: string } & Record<string, unknown> = {};
  try {
    json = (await res.json()) as typeof json;
  } catch {
    json = {};
  }
  if (!res.ok || json.ok !== true) {
    throw new Error(json.error || fallbackError);
  }
  return json;
}

/** Площадка сняла вышедший релиз: артист видит «Обновляем на площадках». */
export async function markPlatformIssue(
  releaseId: string,
  input: { platforms: string[]; reasons: string[]; note: string; notify: boolean }
): Promise<{ at: string }> {
  const json = await sendAdminJson(
    "POST",
    `/api/admin/releases/${encodeURIComponent(releaseId)}/platform-issue`,
    input,
    "Не удалось сохранить."
  );
  return { at: typeof json.platform_issue_at === "string" ? json.platform_issue_at : new Date().toISOString() };
}

/** Релиз вернулся на площадки. */
export async function resolvePlatformIssue(releaseId: string, notify = true): Promise<void> {
  await sendAdminJson(
    "DELETE",
    `/api/admin/releases/${encodeURIComponent(releaseId)}/platform-issue`,
    { notify },
    "Не удалось сохранить."
  );
}

/** Новая обложка релиза: файл уходит прямо в Storage по одноразовой ссылке, потом ставим её релизу. */
export async function replaceReleaseArtwork(
  releaseId: string,
  file: File
): Promise<{ artworkUrl: string; replacedAt: string }> {
  const mime = file.type === "image/png" || file.name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  const path = `/api/admin/releases/${encodeURIComponent(releaseId)}/artwork`;
  const ticket = await sendAdminJson("POST", path, { mime, size: file.size }, "Не удалось подготовить загрузку.");
  const { createSupabaseBrowser } = await import("@/lib/supabase");
  const { error } = await createSupabaseBrowser()
    .storage.from(String(ticket.bucket))
    .uploadToSignedUrl(String(ticket.path), String(ticket.token), file, { contentType: mime, upsert: true });
  if (error) throw new Error("Обложка не загрузилась. Проверь интернет и попробуй ещё раз.");
  const done = await sendAdminJson("PATCH", path, { path: ticket.path }, "Не удалось сохранить обложку.");
  return { artworkUrl: String(done.artwork_url), replacedAt: String(done.artwork_replaced_at) };
}
