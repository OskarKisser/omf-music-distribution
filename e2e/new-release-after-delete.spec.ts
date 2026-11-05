import { test, expect } from "@playwright/test";

const STORE_KEY = "omf_create_release_draft_v2";

/**
 * Модератор удалил релиз, а в телефоне остался его черновик с замечаниями. «Создать релиз»
 * должен открыть пустой паспорт, а не форму удалённого релиза с чужим комментарием.
 */
test("@regression «Создать релиз» не подтягивает черновик удалённого релиза", async ({ page }) => {
  await page.addInitScript((key) => {
    const state = {
      releaseId: "deleted-release-id",
      clientRequestId: "old-client-request",
      moderatorNotes: "Своя причина ТЕСТ",
      metadata: { primaryArtist: "KISSER", releaseTitle: "LAFFERA", releaseType: "single", label: "OMF" },
      tracks: [{ title: "LAFFERA", explicit: false, lyrics: "", featuringArtistNames: [] }],
      lastModified: Date.now()
    };
    window.localStorage.setItem(key, JSON.stringify({ state, version: 0 }));
  }, STORE_KEY);

  // Сервер: у артиста релизов нет (удалён). Любая запись — ошибка: тест не должен ничего создавать.
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    if (new URL(req.url()).pathname === "/api/releases/my") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, rows: [] }) });
      return;
    }
    if (req.method() === "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) });
  });

  await page.goto("/library?devUserId=1");
  // Пустая библиотека: первый релиз начинается с выбора формата.
  await page.getByRole("button", { name: /^сингл/i }).click();
  await page.waitForURL(/\/create\/metadata/);

  await expect(page.getByPlaceholder(/основное название релиза/i)).toHaveValue("");
  await expect(page.getByText(/замечания модератора/i)).toHaveCount(0);
  await expect(page.getByText("Своя причина ТЕСТ")).toHaveCount(0);
});
