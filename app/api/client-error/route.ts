import { NextResponse } from "next/server";
import { z } from "zod";
import { notifyAdminError } from "@/lib/admin-notify.server";
import { createClient } from "@supabase/supabase-js";
import { supabaseNoStoreFetch } from "@/lib/supabase-no-store-fetch";

const bodySchema = z.object({
  userId: z.number().int().nullable().optional(),
  route: z.string().nullable().optional(),
  screenName: z.string().max(512).nullable().optional(),
  errorMessage: z.string().min(1).max(8000),
  stackTrace: z.string().max(32000).nullable().optional(),
  componentStack: z.string().max(32000).nullable().optional(),
  extra: z.record(z.string(), z.unknown()).nullable().optional()
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { userId, route, screenName, errorMessage, stackTrace, componentStack, extra } =
    parsed.data;

  const resolvedScreenName = screenName?.trim() || route || "unknown";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && serviceKey) {
    try {
      const admin = createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: supabaseNoStoreFetch }
      });
      const fullRow = {
        user_id: userId ?? null,
        route: route ?? null,
        screen_name: resolvedScreenName,
        error_message: errorMessage,
        stack_trace: stackTrace ?? null,
        component_stack: componentStack ?? null,
        extra: extra ?? null
      };
      let { error } = await admin.from("error_logs").insert(fullRow);
      if (error && /component_stack|schema cache|could not find.*column/i.test(error.message)) {
        ({ error } = await admin.from("error_logs").insert({
          user_id: userId ?? null,
          route: route ?? null,
          error_message: errorMessage,
          stack_trace: stackTrace ?? null,
          extra: extra ?? null
        }));
      }
      if (error && /screen_name|schema cache|could not find.*column/i.test(error.message)) {
        ({ error } = await admin.from("error_logs").insert({
          user_id: userId ?? null,
          route: route ?? null,
          error_message: errorMessage,
          stack_trace: stackTrace ?? null,
          extra: extra ?? null
        }));
      }
      if (error) {
        console.error("[client-error] Supabase insert failed:", error.message);
      }
    } catch (e) {
      console.error("[client-error] insert exception:", e);
    }
  } else {
    console.error("[client-error] no service role, server log only:", {
      userId,
      route,
      screen_name: resolvedScreenName,
      errorMessage
    });
  }

  await notifyAdminError(resolvedScreenName, errorMessage);
  return NextResponse.json({ ok: true }, { status: 200 });
}
