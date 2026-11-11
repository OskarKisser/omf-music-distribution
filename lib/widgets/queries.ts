/**
 * Ответы на запросы из карточек (W.request → апдейт widget_query).
 * Первая буква запроса — карточка: r — «Мои релизы», a — пульт админа.
 * Права проверяем по from.id при каждом запросе; чужим — пустой ответ "0" (карточка покажет ошибку).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentAnswer } from "@/lib/release-payment";
import { setReleasePaymentStatus } from "@/lib/server/payment-confirm";
import { loadArtistReleases, loadPaymentPage, loadQueue } from "./data";
import { isAdminChat } from "./service";
import { paymentDone, paymentPage, queuePage, releaseDetail, releasesPage, type ReleasesFilter } from "./state";

export const EMPTY_ANSWER = "0";

export type QueryResult = {
  answer: string;
  /** После ответа обновить карточки этих артистов и пульт (оплата поменялась). */
  kick?: boolean;
};

const PAYMENT: Record<string, PaymentAnswer> = { p: "paid", u: "unpaid", n: "not_client" };
const PAYMENT_DONE: Record<PaymentAnswer, string> = {
  paid: "Отмечено: оплатил",
  unpaid: "Отмечено: не оплатил",
  not_client: "Отмечено: не мой клиент"
};

async function artistQuery(admin: SupabaseClient, fromId: string, data: string): Promise<QueryResult> {
  let m = /^r:p:([amd]):(\d{1,4})$/.exec(data);
  if (m) {
    const items = await loadArtistReleases(admin, fromId, new Date());
    return { answer: releasesPage(items, m[1] as ReleasesFilter, Number(m[2])) };
  }
  m = /^r:d:([0-9a-f]{8})$/.exec(data);
  if (m) {
    // Ищем только среди релизов этого артиста — чужой релиз по id не открыть.
    const items = await loadArtistReleases(admin, fromId, new Date());
    const hits = items.filter((it) => it.release.id.toLowerCase().startsWith(m![1]));
    return { answer: hits.length === 1 ? releaseDetail(hits[0]) : EMPTY_ANSWER };
  }
  return { answer: EMPTY_ANSWER };
}

async function adminQuery(admin: SupabaseClient, data: string): Promise<QueryResult> {
  let m = /^a:q:(\d{1,4})$/.exec(data);
  if (m) return { answer: queuePage(await loadQueue(admin, new Date()), Number(m[1])) };
  m = /^a:m:(\d{1,4})$/.exec(data);
  if (m) {
    const off = Number(m[1]);
    const { items, total } = await loadPaymentPage(admin, off);
    return { answer: paymentPage(items, off, total) };
  }
  m = /^a:y:([pun]):([0-9a-f-]{36})$/i.exec(data);
  if (m) {
    const answer = PAYMENT[m[1]];
    // Та же функция, что у кнопок «Оплатил?» и в админке: логи, скидка и бонус за друга — в одном месте.
    const res = await setReleasePaymentStatus(admin, m[2].toLowerCase(), answer, "admin");
    if (!res.ok) return { answer: EMPTY_ANSWER };
    const { items, total } = await loadPaymentPage(admin, 0);
    return { answer: paymentDone(PAYMENT_DONE[answer], items, total), kick: true };
  }
  return { answer: EMPTY_ANSWER };
}

export async function handleWidgetQueryData(
  admin: SupabaseClient,
  fromId: string | number | null | undefined,
  data: string | null | undefined
): Promise<QueryResult> {
  const from = fromId == null ? "" : String(fromId);
  if (!/^\d+$/.test(from) || typeof data !== "string" || data.length === 0) return { answer: EMPTY_ANSWER };
  if (data.startsWith("r:")) return artistQuery(admin, from, data);
  if (data.startsWith("a:")) return isAdminChat(from) ? adminQuery(admin, data) : { answer: EMPTY_ANSWER };
  return { answer: EMPTY_ANSWER };
}
