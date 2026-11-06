/**
 * fetch для серверных Supabase-клиентов без Data Cache Next.js.
 * В Next 14 `fetch` в Route Handler кэшируется по умолчанию (даже с `dynamic = "force-dynamic"`),
 * а Data Cache на Vercel переживает деплои: GET с одинаковым URL отдавал вчерашние строки
 * (очередь модерации показывала давно принятый релиз и не видела новый).
 */
export const supabaseNoStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });
