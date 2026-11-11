import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSupabaseMock, type MockCall, type MockResult } from "./helpers/supabase-mock";

const tg = vi.hoisted(() => ({
  sendWidget: vi.fn(),
  editMessageWidgetData: vi.fn(),
  editWidgetCaption: vi.fn(),
  answerWidgetQuery: vi.fn(),
  setPayment: vi.fn(),
  loadArtist: vi.fn(),
  loadQueue: vi.fn(),
  countUnpaid: vi.fn(),
  countNew24h: vi.fn(),
  loadPaymentPage: vi.fn()
}));

vi.mock("../lib/widgets/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/widgets/api")>("../lib/widgets/api");
  return {
    ...actual,
    sendWidget: tg.sendWidget,
    editMessageWidgetData: tg.editMessageWidgetData,
    editWidgetCaption: tg.editWidgetCaption,
    answerWidgetQuery: tg.answerWidgetQuery
  };
});
vi.mock("../lib/widgets/data", () => ({
  loadArtistReleases: tg.loadArtist,
  loadQueue: tg.loadQueue,
  countUnpaid: tg.countUnpaid,
  countNew24h: tg.countNew24h,
  loadPaymentPage: tg.loadPaymentPage
}));
vi.mock("../lib/server/payment-confirm", () => ({ setReleasePaymentStatus: tg.setPayment }));

import { extractWidgetQuery, parseCommand } from "@/lib/widgets/bot";
import { EMPTY_ANSWER, handleWidgetQueryData } from "@/lib/widgets/queries";
import { buildState, refreshWidget, sendWidgetCard, widgetsAllowed, type WidgetRecord } from "@/lib/widgets/service";
import { releaseItem, type ArtistRelease } from "@/lib/widgets/state";

const ADMIN = "111";
const ARTIST = "222";
const ID = "abcdef12-0000-4000-8000-000000000001";

function item(over: Partial<ArtistRelease> = {}) {
  return releaseItem(
    {
      id: ID,
      title: "Ночной город",
      artist: "Север",
      type: "Сингл",
      status: "processing",
      smartLink: null,
      releaseDate: "2026-11-20",
      submittedAt: new Date(Date.now() - 5 * 36e5).toISOString(),
      platformIssue: null,
      ...over
    },
    new Date()
  );
}

function db(resolve: (c: MockCall) => MockResult = () => ({ data: [], error: null })) {
  const m = createSupabaseMock(resolve);
  return { admin: m.client as never, calls: m.calls };
}

beforeEach(() => {
  for (const f of Object.values(tg)) f.mockReset();
  vi.stubEnv("ADMIN_TELEGRAM_ID", ADMIN);
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "token");
  vi.stubEnv("WIDGETS_ONLY", "");
  vi.stubEnv("TELEGRAM_MINI_APP_URL", "https://t.me/omf_bot/app");
  tg.loadArtist.mockResolvedValue([item()]);
  tg.loadQueue.mockResolvedValue([{ id: ID, title: "Пыль", artist: "Мира", waitMin: 600 }]);
  tg.countUnpaid.mockResolvedValue(3);
  tg.countNew24h.mockResolvedValue(5);
  tg.loadPaymentPage.mockResolvedValue({ items: [], total: 0 });
});
afterEach(() => vi.unstubAllEnvs());

describe("разбор апдейтов", () => {
  it("widget_query достаётся из сырого Update, даже если тип о нём не знает", () => {
    const raw = JSON.parse(`{"update_id":1,"widget_query":{"id":"q1","from":{"id":${ARTIST}},"data":"r:p:a:0"}}`);
    expect(extractWidgetQuery(raw)).toMatchObject({ id: "q1", data: "r:p:a:0" });
    expect(extractWidgetQuery({ update_id: 2, message: {} })).toBeNull();
    expect(extractWidgetQuery({ widget_query: { data: "x" } })).toBeNull();
  });
  it("команды с упоминанием бота", () => {
    expect(parseCommand("/releases")).toBe("releases");
    expect(parseCommand("/today@omf_bot")).toBe("today");
    expect(parseCommand("привет")).toBeNull();
  });
});

describe("права на запросы", () => {
  it("пульт — только админу; чужим пустой ответ", async () => {
    const { admin } = db();
    expect((await handleWidgetQueryData(admin, ARTIST, "a:q:0")).answer).toBe(EMPTY_ANSWER);
    expect((await handleWidgetQueryData(admin, ARTIST, `a:y:p:${ID}`)).answer).toBe(EMPTY_ANSWER);
    expect(tg.setPayment).not.toHaveBeenCalled();
    expect(JSON.parse((await handleWidgetQueryData(admin, ADMIN, "a:q:0")).answer)[1]).toBe(1);
  });

  it("экран релиза — только среди своих релизов", async () => {
    const { admin } = db();
    const mine = JSON.parse((await handleWidgetQueryData(admin, ARTIST, "r:d:abcdef12")).answer);
    expect(mine[0]).toBe(ID);
    expect(tg.loadArtist).toHaveBeenCalledWith(admin, ARTIST, expect.any(Date));
    tg.loadArtist.mockResolvedValue([]);
    expect((await handleWidgetQueryData(admin, "333", "r:d:abcdef12")).answer).toBe(EMPTY_ANSWER);
  });

  it("мусор и чужие префиксы — пустой ответ", async () => {
    const { admin } = db();
    for (const d of ["", "x:1", "r:p:z:0", "r:d:../../", "a:y:x:" + ID, "r:p:a:99999"]) {
      expect((await handleWidgetQueryData(admin, ADMIN, d)).answer).toBe(EMPTY_ANSWER);
    }
    expect((await handleWidgetQueryData(admin, null, "r:p:a:0")).answer).toBe(EMPTY_ANSWER);
  });
});

describe("отметка оплаты из карточки", () => {
  it("та же функция, что у кнопок; ответ — новый список", async () => {
    const { admin } = db();
    tg.setPayment.mockResolvedValue({ ok: true, previous: "awaiting", release: {} });
    tg.loadPaymentPage.mockResolvedValue({ items: [{ id: ID, title: "Маяки", artist: "Мира", discountRub: 500 }], total: 1 });
    const res = await handleWidgetQueryData(admin, ADMIN, `a:y:n:${ID.toUpperCase()}`);
    expect(tg.setPayment).toHaveBeenCalledWith(admin, ID, "not_client", "admin");
    expect(JSON.parse(res.answer).slice(0, 4)).toEqual(["Отмечено: не мой клиент", 1, 0, 1]);
    expect(res.kick).toBe(true);
  });
  it("релиз не найден — пустой ответ, карточка покажет ошибку", async () => {
    const { admin } = db();
    tg.setPayment.mockResolvedValue({ ok: false, status: 404, error: "нет" });
    expect((await handleWidgetQueryData(admin, ADMIN, `a:y:p:${ID}`)).answer).toBe(EMPTY_ANSWER);
  });
});

describe("отправка и обновление", () => {
  it("WIDGETS_ONLY: карточки только перечисленным", () => {
    vi.stubEnv("WIDGETS_ONLY", `${ADMIN}, 444`);
    expect(widgetsAllowed(ADMIN)).toBe(true);
    expect(widgetsAllowed(ARTIST)).toBe(false);
    vi.stubEnv("WIDGETS_ONLY", "");
    expect(widgetsAllowed(ARTIST)).toBe(true);
    expect(widgetsAllowed("abc")).toBe(false);
  });

  it("отправка запоминает карточку; ссылка на приложение подставлена", async () => {
    const { admin, calls } = db();
    tg.sendWidget.mockResolvedValue({ ok: true, result: { message_id: 77, chat: { id: 222 } } });
    const res = await sendWidgetCard(admin, "releases", ARTIST);
    expect(res).toEqual({ ok: true, messageId: 77 });
    const arg = tg.sendWidget.mock.calls[0][0];
    expect(arg.html).toContain("https://t.me/omf_bot/app");
    expect(arg.html).not.toContain("%APP%");
    expect(arg.caption).toContain("Ночной город");
    const up = calls.find((c) => c.table === "widget_messages" && c.op === "upsert");
    expect(up?.payload).toMatchObject({ chat_id: ARTIST, kind: "releases", message_id: 77 });
  });

  it("пульт не уходит не-админу; карточка не ушла — сообщаем вызывающему", async () => {
    const { admin } = db();
    expect(await sendWidgetCard(admin, "today", ARTIST)).toEqual({ ok: false, reason: "not_admin" });
    tg.sendWidget.mockResolvedValue({ ok: false, error: "Bad Request: method not found" });
    expect(await sendWidgetCard(admin, "releases", ARTIST)).toMatchObject({ ok: false, reason: "failed" });
  });

  it("без изменений Telegram не трогаем", async () => {
    const { admin } = db();
    const st = await buildState(admin, "releases", ARTIST);
    const rec: WidgetRecord = { chat_id: ARTIST, kind: "releases", message_id: 5, data_key: st.key, caption: st.caption };
    expect(await refreshWidget(admin, rec)).toBe("unchanged");
    expect(tg.editMessageWidgetData).not.toHaveBeenCalled();
    expect(tg.editWidgetCaption).not.toHaveBeenCalled();
  });

  it("изменения — правим данные и подпись, запоминаем новый ключ", async () => {
    const { admin, calls } = db();
    tg.editMessageWidgetData.mockResolvedValue({ ok: true, result: true });
    tg.editWidgetCaption.mockResolvedValue({ ok: true, result: true });
    const rec: WidgetRecord = { chat_id: ARTIST, kind: "releases", message_id: 5, data_key: "old", caption: "old" };
    expect(await refreshWidget(admin, rec)).toBe("edited");
    expect(tg.editMessageWidgetData).toHaveBeenCalledWith(expect.objectContaining({ chatId: ARTIST, messageId: 5 }));
    expect(calls.some((c) => c.table === "widget_messages" && c.op === "upsert")).toBe(true);
  });

  it("сообщение удалили или бота заблокировали — убираем из учёта", async () => {
    const { admin, calls } = db();
    tg.editMessageWidgetData.mockResolvedValue({ ok: false, error: "Forbidden: bot was blocked by the user", code: 403 });
    const rec: WidgetRecord = { chat_id: ARTIST, kind: "releases", message_id: 5, data_key: "old", caption: "old" };
    expect(await refreshWidget(admin, rec)).toBe("removed");
    expect(calls.some((c) => c.table === "widget_messages" && c.op === "delete")).toBe(true);
  });

  it("роль админа сняли — пульт больше не обновляем", async () => {
    const { admin, calls } = db();
    const rec: WidgetRecord = { chat_id: "999", kind: "today", message_id: 5, data_key: "old", caption: "old" };
    expect(await refreshWidget(admin, rec)).toBe("removed");
    expect(tg.editMessageWidgetData).not.toHaveBeenCalled();
    expect(calls.some((c) => c.table === "widget_messages" && c.op === "delete")).toBe(true);
  });
});
