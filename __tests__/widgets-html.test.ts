import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { RELEASES_WIDGET_HTML, TODAY_WIDGET_HTML } from "@/lib/widgets/html.generated";
// @ts-expect-error — .mjs без типов
import { extractWidget, renderGenerated, WIDGETS } from "../scripts/build-widgets.mjs";
import { readFileSync } from "node:fs";

const CARDS = { releases: RELEASES_WIDGET_HTML, today: TODAY_WIDGET_HTML } as const;
const PREFIX = { releases: "r", today: "a" } as const;
const APP = "https://t.me/omf_bot/app";

describe("код карточек", () => {
  it("бот шлёт ровно тот код, что лежит в мокапах (node scripts/build-widgets.mjs)", () => {
    expect(readFileSync("lib/widgets/html.generated.ts", "utf8")).toBe(renderGenerated());
    for (const [name, file] of Object.entries(WIDGETS as Record<string, string>)) {
      expect(CARDS[name as keyof typeof CARDS]).toBe(extractWidget(file));
    }
  });

  for (const [name, html] of Object.entries(CARDS)) {
    describe(name, () => {
      const sent = html.replace("%APP%", APP);

      it("≤ 32 КБ и < 4070 байт после zlib-9 (предел Telegram 4096)", () => {
        expect(Buffer.byteLength(sent)).toBeLessThan(32768);
        expect(zlib.deflateSync(Buffer.from(sent), { level: 9 }).length).toBeLessThan(4070);
      });

      it("без запрещённого: сеть, vh, прокрутка, input, внешние картинки", () => {
        for (const re of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /\d+vh\b/, /overflow\s*:\s*(auto|scroll)/, /<input/i, /\bsrc\s*=\s*["']?https?:/i, /@font-face/]) {
          expect(sent, String(re)).not.toMatch(re);
        }
      });

      it("ссылки на Telegram — через openTelegramLink, а не openLink", () => {
        expect(sent).not.toMatch(/openLink\(/);
        expect(sent).toContain("openTelegramLink(");
      });

      it("все запросы начинаются со своего префикса", () => {
        const reqs = [...sent.matchAll(/(?:W\.request|ask)\(\s*(["'`])([^"'`]*)/g)].map((m) => m[2]);
        expect(reqs.length).toBeGreaterThan(0);
        for (const r of reqs) expect(r.startsWith(PREFIX[name as keyof typeof PREFIX] + ":"), r).toBe(true);
      });

      it("учитывает время поверх карточки без подписи (safe-area)", () => {
        expect(sent).toContain("env(safe-area-inset-bottom)");
      });
    });
  }
});
