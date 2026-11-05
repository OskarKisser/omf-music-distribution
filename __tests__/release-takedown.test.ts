import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createSupabaseMock, type MockCall } from "./helpers/supabase-mock";
import { canRequestTakedown } from "@/lib/release-takedown";
import { getReleaseStatusMeta, normalizeReleaseStatus } from "@/lib/release-status";
import { getReleaseNextStep } from "@/lib/release-next-step";

const guard = vi.fn();
const notifyArtist = vi.fn();
const notifyAdminTakedownRequested = vi.fn();
let db = createSupabaseMock(() => ({ data: null, error: null }));

vi.mock("../lib/admin-release-api-guard", () => ({
  requireAdminSupabaseClient: (...a: unknown[]) => guard(...a)
}));
vi.mock("../lib/api/with-telegram-auth", () => ({ getTelegramAuthContextFromRequest: () => null }));
vi.mock("../lib/server/artist-notify", () => ({ notifyArtist: (...a: unknown[]) => notifyArtist(...a) }));
vi.mock("../lib/server/release-list-cache", () => ({ invalidateMyReleasesCache: async () => {} }));
vi.mock("../lib/admin-notify.server", () => ({
  notifyAdminTakedownRequested: (...a: unknown[]) => notifyAdminTakedownRequested(...a)
}));
vi.mock("../lib/api/resolve-submit-actor", () => ({
  resolveReleaseActor: async () => ({ kind: "telegram", telegramUserId: 123 })
}));
vi.mock("../lib/supabase-admin", () => ({ createSupabaseAdmin: () => db.client }));
vi.mock("../lib/release-ownership.server", () => ({ isReleaseActorOwner: async () => true }));

const ID = "11111111-1111-4111-8111-111111111111";

function useRow(row: Record<string, unknown> | null) {
  db = createSupabaseMock((call: MockCall) => ({ data: call.op === "select" ? row : null, error: null }));
  guard.mockResolvedValue({ ok: true, supabase: db.client });
}

function post(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

beforeEach(() => {
  guard.mockReset();
  notifyArtist.mockReset();
  notifyAdminTakedownRequested.mockReset();
});

describe("статус removed", () => {
  it("нормализуется и подписан", () => {
    expect(normalizeReleaseStatus("removed")).toBe("removed");
    expect(getReleaseStatusMeta("removed").label).toBe("Удалён");
    expect(getReleaseNextStep({ status: "removed" }).kind).toBe("removed");
  });

  it("удалить можно только отправленный релиз", () => {
    expect(canRequestTakedown("ready")).toBe(true);
    expect(canRequestTakedown("processing")).toBe(true);
    for (const s of ["draft", "pending", "failed", "removed"]) expect(canRequestTakedown(s)).toBe(false);
  });
});

describe("POST /api/releases/request-takedown", () => {
  const url = "http://localhost/api/releases/request-takedown";

  it("ставит отметку и пишет модератору с причиной", async () => {
    useRow({ id: ID, status: "ready", title: "Лето", artist_name: "Вася", telegram_id: "123" });
    const { POST } = await import("@/app/api/releases/request-takedown/route");
    const res = await POST(post(url, { releaseId: ID, reason: "перевыпуск" }));
    expect(res.status).toBe(200);
    const upd = db.calls.find((c) => c.op === "update");
    expect(upd?.payload).toMatchObject({ takedown_reason: "перевыпуск" });
    expect(notifyAdminTakedownRequested).toHaveBeenCalledWith(
      expect.objectContaining({ releaseId: ID, title: "Лето", reason: "перевыпуск" })
    );
  });

  it("повторный запрос не дёргает модератора", async () => {
    useRow({ id: ID, status: "ready", takedown_requested_at: "2026-11-01T00:00:00Z" });
    const { POST } = await import("@/app/api/releases/request-takedown/route");
    const res = await POST(post(url, { releaseId: ID }));
    expect(await res.json()).toMatchObject({ ok: true, alreadyRequested: true });
    expect(notifyAdminTakedownRequested).not.toHaveBeenCalled();
  });

  it("409 для черновика", async () => {
    useRow({ id: ID, status: "draft" });
    const { POST } = await import("@/app/api/releases/request-takedown/route");
    expect((await POST(post(url, { releaseId: ID }))).status).toBe(409);
  });
});

describe("POST /api/admin/releases/[id]/takedown", () => {
  const url = `http://localhost/api/admin/releases/${ID}/takedown`;

  it("переводит в removed и пишет артисту", async () => {
    useRow({ id: ID, status: "ready", title: "Лето", telegram_id: "123" });
    const { POST } = await import("@/app/api/admin/releases/[releaseId]/takedown/route");
    const res = await POST(post(url), { params: { releaseId: ID } });
    expect(res.status).toBe(200);
    expect(db.calls.find((c) => c.op === "update")?.payload).toEqual({ status: "removed" });
    expect(String(notifyArtist.mock.calls[0][1])).toContain("удалён с площадок");
  });

  it("уже удалён — ничего не делает", async () => {
    useRow({ id: ID, status: "removed" });
    const { POST } = await import("@/app/api/admin/releases/[releaseId]/takedown/route");
    const res = await POST(post(url), { params: { releaseId: ID } });
    expect(await res.json()).toMatchObject({ alreadyRemoved: true });
    expect(notifyArtist).not.toHaveBeenCalled();
  });

  it("409 для черновика", async () => {
    useRow({ id: ID, status: "draft" });
    const { POST } = await import("@/app/api/admin/releases/[releaseId]/takedown/route");
    expect((await POST(post(url), { params: { releaseId: ID } })).status).toBe(409);
  });
});
