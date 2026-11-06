import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseNoStoreFetch } from "@/lib/supabase-no-store-fetch";

/**
 * Серверный клиент с service role (обходит RLS). Только в Route Handlers / Server Components.
 */
export function createSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: supabaseNoStoreFetch }
  });
}
