import { describe, it, expect } from "vitest";
import { widgetDeepLinkPath } from "@/lib/widget-deeplink";

const ID = "1a2b3c4d-0000-4000-8000-000000000001";

describe("ссылки из карточек в мини-приложение", () => {
  it("релиз артиста и релиз в админке", () => {
    expect(widgetDeepLinkPath(`r_${ID}`, false)).toBe(`/release/${ID}`);
    expect(widgetDeepLinkPath(`a_${ID.toUpperCase()}`, true)).toBe(`/admin/release/${ID}`);
  });
  it("админская ссылка у не-админа и мусор — никуда", () => {
    expect(widgetDeepLinkPath(`a_${ID}`, false)).toBeNull();
    expect(widgetDeepLinkPath("admin", true)).toBeNull();
    expect(widgetDeepLinkPath("ref_K7X2QP", false)).toBeNull();
    expect(widgetDeepLinkPath(`r_${ID}/../x`, false)).toBeNull();
    expect(widgetDeepLinkPath(null, true)).toBeNull();
  });
});
