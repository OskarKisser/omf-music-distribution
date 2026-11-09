import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  createSupabaseMock,
  filterValue,
  type MockCall,
  type MockResult
} from "./helpers/supabase-mock";

const resolveReleaseActor = vi.fn();
const createSupabaseAdmin = vi.fn();
const getTelegramAuthContextFromRequest = vi.fn();

vi.mock("../lib/api/resolve-submit-actor", () => ({
  resolveReleaseActor: (...a: unknown[]) => resolveReleaseActor(...a)
}));
vi.mock("../lib/supabase-admin", () => ({
  createSupabaseAdmin: () => createSupabaseAdmin()
}));
vi.mock("../lib/api/with-telegram-auth", () => ({
  getTelegramAuthContextFromRequest: (...a: unknown[]) => getTelegramAuthContextFromRequest(...a)
}));
vi.mock("../lib/server/release-list-cache", () => ({
  invalidateMyReleasesCache: async () => {}
}));
vi.mock("../lib/admin", () => ({
  getExpectedAdminTelegramId: () => 999,
  telegramIdsEqual: (a: number, b: number) => String(a) === String(b)
}));

const RELEASE_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_REQ_ID = "33333333-3333-4333-8333-333333333333";
const OWNER = { kind: "telegram", telegramUserId: 1 } as const;
const ownRow = (status = "draft") => ({
  id: RELEASE_ID,
  user_id: "1",
  telegram_id: "1",
  user_uuid: null,
  status,
  collaborators: null
});

function post(path: string, body: unknown, method = "POST") {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-telegram-user-id": "1" },
    body: JSON.stringify(body)
  });
}

function useDb(resolve: (call: MockCall) => MockResult) {
  const db = createSupabaseMock(resolve);
  createSupabaseAdmin.mockReturnValue(db.client);
  return db;
}

const ok = (data: unknown): MockResult => ({ data, error: null });

beforeEach(() => {
  resolveReleaseActor.mockReset();
  createSupabaseAdmin.mockReset();
  getTelegramAuthContextFromRequest.mockReset();
});

describe("POST /api/releases/save-draft-patch", () => {
  it("401 без проверенной сессии, даже с заголовком x-telegram-user-id", async () => {
    resolveReleaseActor.mockResolvedValue(null);
    useDb(() => ok(null));
    const { POST } = await import("@/app/api/releases/save-draft-patch/route");
    const res = await POST(post("/api/releases/save-draft-patch", { releaseId: RELEASE_ID, patch: { title: "x" } }));
    expect(res.status).toBe(401);
  });

  it("400 на колонки вне allowlist (user_id, admin_notes, status=processing)", async () => {
    resolveReleaseActor.mockResolvedValue(OWNER);
    const db = useDb(() => ok(ownRow()));
    const { POST } = await import("@/app/api/releases/save-draft-patch/route");
    for (const patch of [{ user_id: "2" }, { admin_notes: "ok" }, { status: "processing" }, { status: "ready" }]) {
      const res = await POST(post("/api/releases/save-draft-patch", { releaseId: RELEASE_ID, patch }));
      expect(res.status).toBe(400);
    }
    expect(db.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("пропускает поля паспорта из мастера (автор, бит, лицензия, TikTok, ссылки)", async () => {
    resolveReleaseActor.mockResolvedValue(OWNER);
    const db = useDb((call) => ok(call.op === "update" ? [ownRow()] : ownRow()));
    const { POST } = await import("@/app/api/releases/save-draft-patch/route");
    const patch = {
      artist_name: "Artist",
      title: "Song",
      release_type: "single",
      genre: "Hip-Hop/Rap",
      release_date: "2026-12-01",
      explicit: false,
      author_full_name: "Иван Иванов",
      music_author: "Beatmaker",
      license_type: "lease",
      tiktok_start_sec: 45,
      artist_links: { spotify: "https://open.spotify.com/artist/x" },
      has_existing_profiles: true,
      collaborators: [],
      artwork_url: "https://example.com/c.png"
    };
    const res = await POST(post("/api/releases/save-draft-patch", { releaseId: RELEASE_ID, patch }));
    expect(res.status).toBe(200);
    const update = db.calls.find((c) => c.op === "update");
    expect(update?.payload).toMatchObject({ license_type: "lease", tiktok_start_sec: 45 });
  });

  it("409 если релиз уже на модерации", async () => {
    resolveReleaseActor.mockResolvedValue(OWNER);
    const db = useDb(() => ok(ownRow("processing")));
    const { POST } = await import("@/app/api/releases/save-draft-patch/route");
    const res = await POST(post("/api/releases/save-draft-patch", { releaseId: RELEASE_ID, patch: { title: "x" } }));
    expect(res.status).toBe(409);
    expect(db.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("403 для чужого релиза", async () => {
    resolveReleaseActor.mockResolvedValue({ kind: "telegram", telegramUserId: 7 });
    useDb(() => ok(ownRow()));
    const { POST } = await import("@/app/api/releases/save-draft-patch/route");
    const res = await POST(post("/api/releases/save-draft-patch", { releaseId: RELEASE_ID, patch: { title: "x" } }));
    expect(res.status).toBe(403);
  });

  it("сохраняет разрешённые поля владельца", async () => {
    resolveReleaseActor.mockResolvedValue(OWNER);
    const db = useDb((call) => ok(call.op === "update" ? [{ ...ownRow(), title: "Новый" }] : ownRow("failed")));
    const { POST } = await import("@/app/api/releases/save-draft-patch/route");
    const res = await POST(
      post("/api/releases/save-draft-patch", {
        releaseId: RELEASE_ID,
        patch: { title: "Новый", status: "draft", error_message: null }
      })
    );
    expect(res.status).toBe(200);
    const update = db.calls.find((c) => c.op === "update");
    expect(update?.payload).toEqual({ title: "Новый", status: "draft", error_message: null });
  });
});

describe("POST /api/releases/create-draft", () => {
  const draftBody = {
    client_request_id: CLIENT_REQ_ID,
    artist_name: "Artist",
    track_name: "Song",
    release_type: "single",
    genre: "Pop",
    release_date: "2026-12-01",
    explicit: false,
    // Попытка подставить чужого владельца — должна игнорироваться.
    user_id: 2,
    telegram_id: 2,
    user_uuid: "44444444-4444-4444-8444-444444444444"
  };

  it("владелец берётся из сессии, а не из тела", async () => {
    resolveReleaseActor.mockResolvedValue(OWNER);
    getTelegramAuthContextFromRequest.mockReturnValue({ user: { id: 1, username: "artist" }, authDate: null });
    const db = useDb((call) => ok(call.op === "insert" ? { id: RELEASE_ID, status: "pending", user_id: "1" } : null));
    const { POST } = await import("@/app/api/releases/create-draft/route");
    const res = await POST(post("/api/releases/create-draft", draftBody));
    expect(res.status).toBe(200);
    const insert = db.calls.find((c) => c.table === "releases" && c.op === "insert");
    expect(insert?.payload).toMatchObject({
      user_id: "1",
      telegram_id: "1",
      telegram_username: "artist",
      title: "Song",
      status: "pending",
      client_request_id: CLIENT_REQ_ID
    });
    expect((insert?.payload as Record<string, unknown>).user_uuid).toBeUndefined();
  });

  it("веб-пользователь без Telegram: user_uuid из сессии и синтетический user_id", async () => {
    const uuid = "22222222-2222-4222-8222-222222222222";
    resolveReleaseActor.mockResolvedValue({ kind: "web", authUserId: uuid });
    const db = useDb((call) => ok(call.op === "insert" ? { id: RELEASE_ID, status: "pending" } : null));
    const { POST } = await import("@/app/api/releases/create-draft/route");
    const res = await POST(post("/api/releases/create-draft", draftBody));
    expect(res.status).toBe(200);
    const insert = db.calls.find((c) => c.table === "releases" && c.op === "insert");
    const payload = insert?.payload as Record<string, unknown>;
    expect(payload.user_uuid).toBe(uuid);
    expect(payload.telegram_id).toBeNull();
    expect(Number(payload.user_id)).toBeGreaterThan(9_000_000_000);
  });

  it("403 если client_request_id принадлежит чужому релизу", async () => {
    resolveReleaseActor.mockResolvedValue({ kind: "telegram", telegramUserId: 7 });
    getTelegramAuthContextFromRequest.mockReturnValue(null);
    const db = useDb(() => ok(ownRow()));
    const { POST } = await import("@/app/api/releases/create-draft/route");
    const res = await POST(post("/api/releases/create-draft", draftBody));
    expect(res.status).toBe(403);
    expect(db.calls.some((c) => c.op === "update" || c.op === "insert")).toBe(false);
  });

  it("409 если релиз с этим client_request_id уже на модерации", async () => {
    resolveReleaseActor.mockResolvedValue(OWNER);
    getTelegramAuthContextFromRequest.mockReturnValue(null);
    useDb(() => ok(ownRow("ready")));
    const { POST } = await import("@/app/api/releases/create-draft/route");
    const res = await POST(post("/api/releases/create-draft", draftBody));
    expect(res.status).toBe(409);
  });
});

describe("/api/releases/tracks", () => {
  const track = {
    releaseId: RELEASE_ID,
    index: 0,
    title: "Song",
    explicit: false,
    audioUrl: "https://example.com/a.wav",
    lyrics: "  "
  };

  it("upsert копирует владельца из релиза", async () => {
    resolveReleaseActor.mockResolvedValue({ kind: "telegram", telegramUserId: 1 });
    const db = useDb((call) => ok(call.table === "releases" ? { ...ownRow(), user_uuid: "u-1" } : null));
    const { POST } = await import("@/app/api/releases/tracks/route");
    const res = await POST(post("/api/releases/tracks", track));
    expect(res.status).toBe(200);
    const upsert = db.calls.find((c) => c.table === "tracks" && c.op === "upsert");
    expect(upsert?.payload).toMatchObject({
      release_id: RELEASE_ID,
      user_id: 1,
      telegram_id: "1",
      user_uuid: "u-1",
      index: 0,
      file_path: track.audioUrl,
      lyrics: null
    });
  });

  it("сохраняет очищенное имя файла, а без него колонку не трогает", async () => {
    resolveReleaseActor.mockResolvedValue({ kind: "telegram", telegramUserId: 1 });
    const db = useDb((call) => ok(call.table === "releases" ? ownRow() : null));
    const { POST } = await import("@/app/api/releases/tracks/route");

    await POST(post("/api/releases/tracks", { ...track, originalFilename: "../Мой трек.wav" }));
    await POST(post("/api/releases/tracks", track));

    const upserts = db.calls.filter((c) => c.table === "tracks" && c.op === "upsert");
    expect(upserts[0]?.payload).toMatchObject({ original_filename: "Мой трек.wav" });
    expect(upserts[1]?.payload).not.toHaveProperty("original_filename");
  });

  it("сохраняет трек и в базе без колонки original_filename", async () => {
    resolveReleaseActor.mockResolvedValue({ kind: "telegram", telegramUserId: 1 });
    const db = useDb((call) => {
      if (call.table === "releases") return ok(ownRow());
      const hasName = Boolean((call.payload as { original_filename?: string } | undefined)?.original_filename);
      return hasName
        ? ({
            data: null,
            error: { message: "Could not find the 'original_filename' column of 'tracks' in the schema cache" }
          } as MockResult)
        : ok(null);
    });
    const { POST } = await import("@/app/api/releases/tracks/route");

    const res = await POST(post("/api/releases/tracks", { ...track, originalFilename: "mix.wav" }));

    expect(res.status).toBe(200);
    const upserts = db.calls.filter((c) => c.table === "tracks" && c.op === "upsert");
    expect(upserts).toHaveLength(2);
    expect(upserts[1]?.payload).not.toHaveProperty("original_filename");
  });

  it("403 для чужого релиза и 409 для отправленного", async () => {
    const { POST, DELETE } = await import("@/app/api/releases/tracks/route");

    resolveReleaseActor.mockResolvedValue({ kind: "telegram", telegramUserId: 7 });
    useDb(() => ok(ownRow()));
    expect((await POST(post("/api/releases/tracks", track))).status).toBe(403);
    expect((await DELETE(post("/api/releases/tracks", { releaseId: RELEASE_ID }, "DELETE"))).status).toBe(403);

    resolveReleaseActor.mockResolvedValue(OWNER);
    const db = useDb(() => ok(ownRow("processing")));
    expect((await POST(post("/api/releases/tracks", track))).status).toBe(409);
    expect((await DELETE(post("/api/releases/tracks", { releaseId: RELEASE_ID }, "DELETE"))).status).toBe(409);
    expect(db.calls.some((c) => c.table === "tracks")).toBe(false);
  });

  it("DELETE удаляет треки своего черновика", async () => {
    resolveReleaseActor.mockResolvedValue(OWNER);
    const db = useDb(() => ok(ownRow("failed")));
    const { DELETE } = await import("@/app/api/releases/tracks/route");
    const res = await DELETE(post("/api/releases/tracks", { releaseId: RELEASE_ID }, "DELETE"));
    expect(res.status).toBe(200);
    const del = db.calls.find((c) => c.table === "tracks" && c.op === "delete");
    expect(filterValue(del!, "eq", "release_id")).toBe(RELEASE_ID);
  });
});

describe("POST /api/releases/mark-failed", () => {
  it("409 для релиза на модерации", async () => {
    resolveReleaseActor.mockResolvedValue(OWNER);
    const db = useDb(() => ok(ownRow("processing")));
    const { POST } = await import("@/app/api/releases/mark-failed/route");
    const res = await POST(post("/api/releases/mark-failed", { releaseId: RELEASE_ID, errorMessage: "x" }));
    expect(res.status).toBe(409);
    expect(db.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("помечает свой черновик как failed", async () => {
    resolveReleaseActor.mockResolvedValue(OWNER);
    const db = useDb((call) =>
      ok(call.op === "update" ? { ...ownRow("failed"), error_message: "Сбой" } : ownRow("pending"))
    );
    const { POST } = await import("@/app/api/releases/mark-failed/route");
    const res = await POST(post("/api/releases/mark-failed", { releaseId: RELEASE_ID, errorMessage: " Сбой " }));
    expect(res.status).toBe(200);
    const update = db.calls.find((c) => c.table === "releases" && c.op === "update");
    expect(update?.payload).toEqual({ status: "failed", error_message: "Сбой" });
  });
});

describe("GET /api/releases/[releaseId]", () => {
  it("отдаёт релиз с треками владельцу", async () => {
    resolveReleaseActor.mockResolvedValue(OWNER);
    useDb((call) => ok(call.table === "releases" ? ownRow() : [{ index: 0, title: "Song" }]));
    const { GET } = await import("@/app/api/releases/[releaseId]/route");
    const res = await GET(new NextRequest(`http://localhost/api/releases/${RELEASE_ID}?tracks=1`), {
      params: { releaseId: RELEASE_ID }
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { record: { id: string }; tracks: unknown[] };
    expect(json.record.id).toBe(RELEASE_ID);
    expect(json.tracks).toHaveLength(1);
  });

  it("403 для чужого и 400 для некорректного id", async () => {
    resolveReleaseActor.mockResolvedValue({ kind: "telegram", telegramUserId: 7 });
    useDb(() => ok(ownRow()));
    const { GET } = await import("@/app/api/releases/[releaseId]/route");
    const denied = await GET(new NextRequest(`http://localhost/api/releases/${RELEASE_ID}`), {
      params: { releaseId: RELEASE_ID }
    });
    expect(denied.status).toBe(403);
    const bad = await GET(new NextRequest("http://localhost/api/releases/abc"), {
      params: { releaseId: "abc" }
    });
    expect(bad.status).toBe(400);
  });
});

describe("GET /api/releases/latest-draft", () => {
  it("фильтрует по владельцу из сессии", async () => {
    resolveReleaseActor.mockResolvedValue(OWNER);
    const db = useDb(() => ok({ id: RELEASE_ID }));
    const { GET } = await import("@/app/api/releases/latest-draft/route");
    const res = await GET(new NextRequest("http://localhost/api/releases/latest-draft"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { releaseId: string }).releaseId).toBe(RELEASE_ID);
    expect(filterValue(db.calls[0], "or")).toBe("user_id.eq.1,telegram_id.eq.1");
  });

  it("401 без сессии", async () => {
    resolveReleaseActor.mockResolvedValue(null);
    useDb(() => ok(null));
    const { GET } = await import("@/app/api/releases/latest-draft/route");
    const res = await GET(new NextRequest("http://localhost/api/releases/latest-draft"));
    expect(res.status).toBe(401);
  });
});
