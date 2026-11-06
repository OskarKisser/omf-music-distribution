import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createSupabaseMock, type MockCall, type MockResult } from "./helpers/supabase-mock";
import {
  buildPressPhotoFilename,
  isOwnPressPhotoPath,
  isPitchingOpen,
  normalizePressText,
  pressKitNoticeKind,
  pressTextError,
  pressTextLength
} from "@/lib/press-kit";

const resolveReleaseActor = vi.fn();
const notifyAdminPressKitSaved = vi.fn();

vi.mock("../lib/admin-notify.server", () => ({
  notifyAdminPressKitSaved: (...a: unknown[]) => notifyAdminPressKitSaved(...a)
}));
const createSupabaseAdmin = vi.fn();

vi.mock("../lib/api/resolve-submit-actor", () => ({
  resolveReleaseActor: (...a: unknown[]) => resolveReleaseActor(...a)
}));
vi.mock("../lib/supabase-admin", () => ({
  createSupabaseAdmin: () => createSupabaseAdmin()
}));
vi.mock("../lib/admin", () => ({
  getExpectedAdminTelegramId: () => 999,
  telegramIdsEqual: (a: number, b: number) => String(a) === String(b)
}));

const RELEASE_ID = "11111111-1111-4111-8111-111111111111";
const PHOTO = `${RELEASE_ID}/22222222-2222-4222-8222-222222222222.jpg`;
const OWNER = { kind: "telegram", telegramUserId: 1 } as const;
const releaseRow = (status = "ready", smart_link: string | null = "https://band.link/x") => ({
  id: RELEASE_ID,
  user_id: "1",
  telegram_id: "1",
  user_uuid: null,
  status,
  smart_link
});

const ok = (data: unknown): MockResult => ({ data, error: null });

function useDb(resolve: (call: MockCall) => MockResult, files: string[] = []) {
  const db = createSupabaseMock(resolve);
  const removed: string[][] = [];
  const storage = {
    from: () => ({
      list: async (_folder: string, opts?: { search?: string }) => ({
        data: files
          .map((p) => ({ name: p.split("/")[1] }))
          .filter((f) => !opts?.search || f.name === opts.search),
        error: null
      }),
      remove: async (paths: string[]) => {
        removed.push(paths);
        return { data: null, error: null };
      },
      createSignedUrls: async (paths: string[]) => ({
        data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}` })),
        error: null
      }),
      createSignedUploadUrl: async (path: string) => ({ data: { path, token: "t", signedUrl: "u" }, error: null })
    })
  };
  createSupabaseAdmin.mockReturnValue({ ...(db.client as object), storage });
  return { ...db, removed };
}

function req(path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const routeCtx = { params: { releaseId: RELEASE_ID } };

beforeEach(() => {
  resolveReleaseActor.mockReset();
  createSupabaseAdmin.mockReset();
  notifyAdminPressKitSaved.mockReset();
});

describe("press-kit rules", () => {
  it("питчинг открыт только у выпущенного релиза со ссылкой", () => {
    expect(isPitchingOpen("ready", "https://band.link/x")).toBe(true);
    expect(isPitchingOpen("ready", " ")).toBe(false);
    expect(isPitchingOpen("processing", "https://band.link/x")).toBe(false);
  });

  it("лимит 300 символов считает эмодзи одним символом", () => {
    expect(pressTextLength("🎧".repeat(300))).toBe(300);
    expect(pressTextError("🎧".repeat(300))).toBeNull();
    expect(pressTextError("a".repeat(301))).not.toBeNull();
    expect(normalizePressText("  \r\n ")).toBeNull();
    expect(normalizePressText(" a\r\nb ")).toBe("a\nb");
  });

  it("путь фото — только в папке своего релиза", () => {
    expect(isOwnPressPhotoPath(PHOTO, RELEASE_ID)).toBe(true);
    expect(isOwnPressPhotoPath(`../${PHOTO}`, RELEASE_ID)).toBe(false);
    expect(isOwnPressPhotoPath(PHOTO.replace(RELEASE_ID, "33333333-3333-4333-8333-333333333333"), RELEASE_ID)).toBe(false);
    expect(isOwnPressPhotoPath(`${RELEASE_ID}/x.svg`, RELEASE_ID)).toBe(false);
  });

  it("уведомление админу: первое заполнение, правка после паузы, без спама", () => {
    const now = Date.parse("2026-11-06T12:00:00Z");
    const filled = { press_text: "a", photo_path: null, updated_at: "2026-11-06T11:58:00Z" };
    expect(pressKitNoticeKind(null, { press_text: "a", photo_path: null }, now)).toBe("filled");
    expect(pressKitNoticeKind({ press_text: null, photo_path: null }, { press_text: null, photo_path: "p" }, now)).toBe("filled");
    expect(pressKitNoticeKind(null, { press_text: null, photo_path: null }, now)).toBeNull();
    // Очистил и сразу заполнил снова — без повторного уведомления.
    expect(pressKitNoticeKind({ press_text: null, photo_path: null, updated_at: "2026-11-06T11:59:00Z" }, { press_text: "a", photo_path: null }, now)).toBeNull();
    expect(pressKitNoticeKind(filled, { press_text: "b", photo_path: null }, now)).toBeNull();
    expect(pressKitNoticeKind({ ...filled, updated_at: "2026-11-06T10:00:00Z" }, { press_text: "b", photo_path: null }, now)).toBe("updated");
    expect(pressKitNoticeKind({ ...filled, updated_at: "2026-11-06T10:00:00Z" }, { press_text: "a", photo_path: null }, now)).toBeNull();
  });

  it("имя файла фото без запрещённых символов", () => {
    expect(buildPressPhotoFilename("MC / Тест", "Трек: 1", "jpg")).toBe("MC Тест — Трек 1 — фото.jpg");
    expect(buildPressPhotoFilename(null, "", "png")).toBe("artist — фото.png");
  });
});

describe("POST /api/releases/[releaseId]/press-kit", () => {
  it("401 без сессии", async () => {
    resolveReleaseActor.mockResolvedValue(null);
    useDb(() => ok(null));
    const { POST } = await import("@/app/api/releases/[releaseId]/press-kit/route");
    const res = await POST(req(`/api/releases/${RELEASE_ID}/press-kit`, { pressText: "x" }), routeCtx);
    expect(res.status).toBe(401);
  });

  it("403 для чужого релиза", async () => {
    resolveReleaseActor.mockResolvedValue({ kind: "telegram", telegramUserId: 7 });
    const db = useDb(() => ok(releaseRow()));
    const { POST } = await import("@/app/api/releases/[releaseId]/press-kit/route");
    const res = await POST(req(`/api/releases/${RELEASE_ID}/press-kit`, { pressText: "x" }), routeCtx);
    expect(res.status).toBe(403);
    expect(db.calls.some((c) => c.op === "upsert")).toBe(false);
  });

  it("409 пока релиз без ссылки", async () => {
    resolveReleaseActor.mockResolvedValue(OWNER);
    const db = useDb(() => ok(releaseRow("ready", null)));
    const { POST } = await import("@/app/api/releases/[releaseId]/press-kit/route");
    const res = await POST(req(`/api/releases/${RELEASE_ID}/press-kit`, { pressText: "x" }), routeCtx);
    expect(res.status).toBe(409);
    expect(db.calls.some((c) => c.op === "upsert")).toBe(false);
  });

  it("400 на текст длиннее 300 символов", async () => {
    resolveReleaseActor.mockResolvedValue(OWNER);
    const db = useDb(() => ok(releaseRow()));
    const { POST } = await import("@/app/api/releases/[releaseId]/press-kit/route");
    const res = await POST(req(`/api/releases/${RELEASE_ID}/press-kit`, { pressText: "a".repeat(301) }), routeCtx);
    expect(res.status).toBe(400);
    expect(db.calls.some((c) => c.op === "upsert")).toBe(false);
  });

  it("400 на фото из чужой папки или не загруженное", async () => {
    resolveReleaseActor.mockResolvedValue(OWNER);
    useDb(() => ok(releaseRow()), []);
    const { POST } = await import("@/app/api/releases/[releaseId]/press-kit/route");
    const foreign = await POST(
      req(`/api/releases/${RELEASE_ID}/press-kit`, { photoPath: "other/22222222-2222-4222-8222-222222222222.jpg" }),
      routeCtx
    );
    expect(foreign.status).toBe(400);
    const missing = await POST(req(`/api/releases/${RELEASE_ID}/press-kit`, { photoPath: PHOTO }), routeCtx);
    expect(missing.status).toBe(400);
  });

  it("сохраняет текст и фото, старое фото удаляет", async () => {
    resolveReleaseActor.mockResolvedValue(OWNER);
    const OLD = `${RELEASE_ID}/44444444-4444-4444-8444-444444444444.png`;
    const saved = { release_id: RELEASE_ID, press_text: "Летний трек", photo_path: PHOTO, updated_at: "2026-10-17T10:00:00Z" };
    let kitReads = 0;
    const db = useDb(
      (call) => {
        if (call.table === "releases") return ok(releaseRow());
        if (call.op === "upsert") return ok(null);
        kitReads += 1;
        return ok(kitReads === 1 ? [{ ...saved, press_text: null, photo_path: OLD }] : [saved]);
      },
      [PHOTO, OLD]
    );
    const { POST } = await import("@/app/api/releases/[releaseId]/press-kit/route");
    const res = await POST(
      req(`/api/releases/${RELEASE_ID}/press-kit`, { pressText: "  Летний трек ", photoPath: PHOTO }),
      routeCtx
    );
    expect(res.status).toBe(200);
    const upsert = db.calls.find((c) => c.op === "upsert");
    expect(upsert?.payload).toMatchObject({ release_id: RELEASE_ID, press_text: "Летний трек", photo_path: PHOTO });
    expect(db.removed).toEqual([[OLD]]);
    expect(notifyAdminPressKitSaved).toHaveBeenCalledTimes(1);
    expect(notifyAdminPressKitSaved.mock.calls[0][0]).toMatchObject({
      releaseId: RELEASE_ID,
      kind: "updated",
      pressText: "Летний трек",
      hasPhoto: true
    });
    const json = (await res.json()) as { kit: { photo_url: string } };
    expect(json.kit.photo_url).toBe(`https://signed/${PHOTO}`);
  });
});

describe("POST /api/releases/[releaseId]/press-kit/photo-upload", () => {
  it("не даёт загрузить не-картинку и слишком большой файл", async () => {
    resolveReleaseActor.mockResolvedValue(OWNER);
    useDb(() => ok(releaseRow()));
    const { POST } = await import("@/app/api/releases/[releaseId]/press-kit/photo-upload/route");
    const path = `/api/releases/${RELEASE_ID}/press-kit/photo-upload`;
    expect((await POST(req(path, { mime: "image/svg+xml", size: 100 }), routeCtx)).status).toBe(400);
    expect((await POST(req(path, { mime: "image/jpeg", size: 11 * 1024 * 1024 }), routeCtx)).status).toBe(400);
  });

  it("выдаёт путь в папке релиза", async () => {
    resolveReleaseActor.mockResolvedValue(OWNER);
    useDb(() => ok(releaseRow()));
    const { POST } = await import("@/app/api/releases/[releaseId]/press-kit/photo-upload/route");
    const res = await POST(req(`/api/releases/${RELEASE_ID}/press-kit/photo-upload`, { mime: "image/webp", size: 1000 }), routeCtx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { path: string };
    expect(isOwnPressPhotoPath(json.path, RELEASE_ID)).toBe(true);
  });
});

describe("GET /api/releases/press-kits", () => {
  it("отдаёт только свои выпущенные релизы", async () => {
    resolveReleaseActor.mockResolvedValue(OWNER);
    const OTHER = "55555555-5555-4555-8555-555555555555";
    const db = useDb((call) => {
      if (call.table === "releases") {
        return ok([releaseRow(), { ...releaseRow(), id: OTHER, user_id: "7", telegram_id: "7" }]);
      }
      return ok([]);
    });
    const { GET } = await import("@/app/api/releases/press-kits/route");
    const res = await GET(req(`/api/releases/press-kits?ids=${RELEASE_ID},${OTHER}`));
    expect(res.status).toBe(200);
    const kitQuery = db.calls.find((c) => c.table === "release_press_kits");
    expect(kitQuery?.filters).toContainEqual(["in", "release_id", [RELEASE_ID]]);
  });
});
