import { describe, it, expect } from "vitest";
import {
  buildReleasesState,
  buildTodayState,
  coarseWait,
  fitRows,
  moscowMinutes,
  paymentDone,
  paymentPage,
  queuePage,
  releaseDetail,
  releaseItem,
  releasesPage,
  shortReleaseDate,
  utf8Bytes,
  type ArtistRelease,
  type PaymentItem,
  type QueueItem
} from "@/lib/widgets/state";

const NOW = new Date("2026-11-11T12:00:00Z"); // 15:00 по Москве
const LONG = "Очень-очень длинное название релиза с бонус-треками, ремиксами и расширенной версией ".repeat(3);

function rel(i: number, over: Partial<ArtistRelease> = {}): ArtistRelease {
  return {
    id: `${(0x10000000 + i).toString(16)}-0000-4000-8000-000000000000`,
    title: `Релиз ${i}`,
    artist: "Север",
    type: "Сингл",
    status: "processing",
    smartLink: null,
    releaseDate: "2026-11-20",
    submittedAt: "2026-11-11T07:00:00Z",
    platformIssue: null,
    ...over
  };
}

describe("вспомогательное", () => {
  it("fitRows оставляет столько строк, сколько влезает", () => {
    const rows = Array.from({ length: 10 }, () => "я".repeat(100));
    const n = fitRows((r) => JSON.stringify(r), rows, 1024);
    expect(utf8Bytes(JSON.stringify(rows.slice(0, n)))).toBeLessThanOrEqual(1024);
    expect(utf8Bytes(JSON.stringify(rows.slice(0, n + 1)))).toBeGreaterThan(1024);
  });
  it("время по Москве в минутах и короткая дата", () => {
    expect(moscowMinutes(NOW)).toBe(15 * 60);
    expect(shortReleaseDate("2026-11-20T00:00:00")).toBe("20 нояб");
    expect(shortReleaseDate("завтра")).toBe("");
  });
  it("ожидание огрубляется до того, что видно в карточке", () => {
    expect(coarseWait(14)).toBe(0);
    expect(coarseWait(44)).toBe(30);
    expect(coarseWait(185)).toBe(180);
    expect(coarseWait(3000)).toBe(2880);
  });
});

describe("Мои релизы", () => {
  it("шаг релиза: на проверке N ч, ссылка готова, вернули", () => {
    expect(releaseItem(rel(1), NOW)).toMatchObject({ k: 3, h: 5 });
    expect(releaseItem(rel(2, { status: "ready", smartLink: "https://x.ru" }), NOW).k).toBe(5);
    expect(releaseItem(rel(3, { status: "failed" }), NOW).k).toBe(2);
    expect(releaseItem(rel(4, { status: "draft" }), NOW).k).toBe(0);
  });

  it("состояние: счётчики, ближайший выход, ключ без времени", () => {
    const items = [
      rel(1),
      rel(2, { status: "ready", smartLink: "https://x.ru", releaseDate: "2026-12-01" }),
      rel(3, { status: "ready", releaseDate: "2026-11-15", title: "Маяки" }),
      rel(4, { status: "ready", releaseDate: "2026-10-01" }),
      rel(5, { status: "failed" }),
      rel(6, { status: "draft" })
    ].map((r) => releaseItem(r, NOW));
    const st = buildReleasesState(items, NOW);
    const d = JSON.parse(st.data);
    expect(d.slice(0, 6)).toEqual([6, 1, 1, 1, ["15 нояб", "Маяки"], 900]);
    expect(d[6]).toHaveLength(4);
    expect(st.key).not.toContain("900");
    // Через минуту без изменений — ключ тот же: Telegram не трогаем.
    expect(buildReleasesState(items, new Date(NOW.getTime() + 60_000)).key).toBe(st.key);
    expect(st.caption).toContain("Мои релизы (6 релизов)");
  });

  it("≤ 1024 байт даже на 200 длинных релизах; страницы и экран релиза тоже", () => {
    const items = Array.from({ length: 200 }, (_, i) => releaseItem(rel(i, { title: LONG, artist: LONG }), NOW));
    expect(utf8Bytes(buildReleasesState(items, NOW).data)).toBeLessThanOrEqual(1024);
    for (const f of ["a", "m", "d"] as const) expect(utf8Bytes(releasesPage(items, f, 8))).toBeLessThanOrEqual(1024);
    const huge = { ...items[0], body: LONG.repeat(10) };
    expect(utf8Bytes(releaseDetail(huge))).toBeLessThanOrEqual(1024);
    expect(JSON.parse(releaseDetail(huge))[0]).toBe(items[0].release.id);
  });

  it("фильтр «Ждут меня» — только вернули и не отправлены", () => {
    const items = [rel(1), rel(2, { status: "failed" }), rel(3, { status: "draft" })].map((r) => releaseItem(r, NOW));
    const [off, total, rows] = JSON.parse(releasesPage(items, "m", 0));
    expect([off, total]).toEqual([0, 2]);
    expect(rows.map((r: unknown[]) => r[2])).toEqual([2, 0]);
  });
});

describe("Пульт", () => {
  const queue: QueueItem[] = Array.from({ length: 300 }, (_, i) => ({ id: rel(i).id, title: LONG, artist: LONG, waitMin: i * 7 }));

  it("очередь — самые старые сверху, состояние ≤ 1024 байт", () => {
    const st = buildTodayState(queue, 17, 5, NOW);
    const d = JSON.parse(st.data);
    expect(utf8Bytes(st.data)).toBeLessThanOrEqual(1024);
    expect(d.slice(0, 5)).toEqual([300, coarseWait(299 * 7), 17, 5, 900]);
    expect(d[5][0][3]).toBe(coarseWait(299 * 7));
    expect(utf8Bytes(queuePage(queue, 296))).toBeLessThanOrEqual(1024);
  });

  it("ответы по оплате ≤ 1024 байт", () => {
    const page: PaymentItem[] = Array.from({ length: 4 }, (_, i) => ({ id: rel(i).id, title: LONG, artist: LONG, discountRub: 500 }));
    expect(utf8Bytes(paymentPage(page, 0, 40))).toBeLessThanOrEqual(1024);
    const done = JSON.parse(paymentDone("Отмечено: оплатил", page, 39));
    expect(done.slice(0, 4)).toEqual(["Отмечено: оплатил", 39, 0, 39]);
  });

  it("пустой день — понятная подпись", () => {
    expect(buildTodayState([], 0, 0, NOW).caption).toBe("Пульт: очередь пуста, оплаты отмечены.");
  });
});
