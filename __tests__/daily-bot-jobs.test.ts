import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createSupabaseMock, filterValue, type MockCall } from "./helpers/supabase-mock";
import { congratulateReleaseDay, draftReminderWindow, moscowToday, remindUnfinishedDrafts } from "@/lib/server/daily-bot-jobs";
import { buildColleaguesMessage } from "@/lib/colleagues-chat";

const notifyArtist = vi.fn();
vi.mock("../lib/server/artist-notify", () => ({ notifyArtist: (...a: unknown[]) => notifyArtist(...a) }));

const NOW = new Date("2026-11-05T07:00:00Z");

function dbWith(rows: Record<string, unknown>[]) {
  return createSupabaseMock((call: MockCall) => ({ data: call.op === "select" ? rows : null, error: null }));
}

beforeEach(() => notifyArtist.mockReset());

describe("даты", () => {
  it("сегодня по Москве", () => {
    expect(moscowToday(new Date("2026-11-05T22:30:00Z"))).toBe("2026-11-06");
    expect(moscowToday(NOW)).toBe("2026-11-05");
  });

  it("окно черновиков: от суток до двух недель", () => {
    expect(draftReminderWindow(NOW)).toEqual({
      from: "2026-10-22T07:00:00.000Z",
      to: "2026-11-04T07:00:00.000Z"
    });
  });
});

describe("напоминание о черновике", () => {
  it("отмечает и пишет каждому", async () => {
    const db = dbWith([
      { id: "a", title: "Лето", status: "draft", telegram_id: "1" },
      { id: "b", title: "Зима", status: "pending", telegram_id: "2" }
    ]);
    notifyArtist.mockResolvedValue(true);
    const res = await remindUnfinishedDrafts(db.client as never, NOW);
    expect(res).toEqual({ candidates: 2, sent: 2 });
    const select = db.calls[0];
    expect(filterValue(select, "is", "draft_reminded_at")).toBeNull();
    expect(db.calls.filter((c) => c.op === "update")).toHaveLength(2);
    expect(String(notifyArtist.mock.calls[1][1])).toContain("Отправить на проверку");
  });
});

describe("день релиза", () => {
  it("ищет сегодняшние принятые и шлёт ссылку", async () => {
    const db = dbWith([{ id: "a", title: "Лето", status: "ready", telegram_id: "1", smart_link: "https://band.link/x" }]);
    notifyArtist.mockResolvedValue(true);
    const res = await congratulateReleaseDay(db.client as never, NOW);
    expect(res.sent).toBe(1);
    expect(filterValue(db.calls[0], "like", "release_date")).toBe("2026-11-05%");
    expect(String(notifyArtist.mock.calls[0][1])).toContain("https://band.link/x");
  });
});

describe("GET /api/cron/daily", () => {
  const prev = process.env.CRON_SECRET;
  afterEach(() => {
    process.env.CRON_SECRET = prev;
  });

  it("без секрета — 401", async () => {
    process.env.CRON_SECRET = "s3cret";
    const { GET } = await import("@/app/api/cron/daily/route");
    const res = await GET(new NextRequest("http://localhost/api/cron/daily", { headers: { authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
  });
});

describe("сообщение коллегам", () => {
  it("форма моноширинно и ссылка на архив", () => {
    const text = buildColleaguesMessage({ form: "1. Название: A&B", bundleUrl: "https://x/b?dl=1&y=2" });
    expect(text).toContain("<pre>1. Название: A&amp;B</pre>");
    expect(text).toContain('href="https://x/b?dl=1&amp;y=2"');
  });
});
