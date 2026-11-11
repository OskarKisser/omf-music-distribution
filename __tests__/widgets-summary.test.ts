import { describe, it, expect, vi, beforeEach } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("../lib/telegram-bot.server", () => ({ sendTelegramBotMessage: send }));

import { createSupabaseMock } from "./helpers/supabase-mock";
import { sendWeeklyWidgetSummary, summaryText } from "@/lib/widgets/summary";

beforeEach(() => {
  send.mockReset();
  vi.stubEnv("ADMIN_TELEGRAM_ID", "111");
});

describe("сводка по карточкам", () => {
  it("текст: без колонки «открывали» строку не пишем", () => {
    expect(summaryText({ cards: 7, opened: 3, updated: 2 })).toContain("Открывали карточку: 3");
    expect(summaryText({ cards: 7, opened: null, updated: 2 })).not.toContain("Открывали");
  });
  it("уходит только по понедельникам по Москве и только админу", async () => {
    const m = createSupabaseMock(() => ({ data: null, error: null, count: 4 }));
    send.mockResolvedValue({ ok: true });
    expect(await sendWeeklyWidgetSummary(m.client as never, new Date("2026-11-11T09:00:00Z"))).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
    expect(await sendWeeklyWidgetSummary(m.client as never, new Date("2026-11-16T07:00:00Z"))).toBe("sent");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ chatId: "111" }));
  });
});
