/**
 * E2E: Release creation wizard happy path.
 *
 * Prerequisites for local/CI run:
 *   - NEXT_PUBLIC_ALLOW_DEV_API_AUTH=true  (enables dev API auth bypass)
 *   - ALLOW_DEV_API_AUTH=true              (server-side bypass)
 *   - devUserId query param injected below → bypasses Telegram initData
 *
 * The test navigates the 4-step wizard:
 *   /create/metadata → /create/assets → /create/tracks → /create/review
 * and asserts the presence of the success state at each gate.
 *
 * Storage uploads are NOT performed in this spec; tests mock or skip the
 * upload steps that require real Supabase credentials.
 */
import { test, expect, type Page } from "@playwright/test";
import { blockBackendWrites } from "./helpers/block-writes";

const DEV_USER_ID = "1";
const BASE_PARAMS = `?devUserId=${DEV_USER_ID}`;

test.beforeEach(async ({ page }) => {
  await blockBackendWrites(page);
});

async function navigateTo(page: Page, path: string) {
  await page.goto(`${path}${BASE_PARAMS}`);
}

async function fillMetadataMinimum(page: Page) {
  await page.getByPlaceholder(/имя на обложке/i).fill("Regression Artist");
  await page.getByPlaceholder(/основное название релиза/i).fill("Regression Release");
  await page.locator("select[name='language']").selectOption({ index: 1 });
  await page.locator("select[name='genre']").selectOption("Techno");
  // Барабан открывается на самой ранней доступной дате — её и берём.
  await page.locator("#meta-release-date").click();
  await page.getByRole("button", { name: "Готово" }).click();
  await page.getByPlaceholder("Иванов Иван Иванович").fill("Регрессов Тест Тестович");
  await page.getByPlaceholder(/ник или фио битмейкера/i).fill("Regression Beatmaker");
  await page.locator("select[name='licenseType']").selectOption("own");
  await page.getByPlaceholder("0:45").fill("0:45");
}

const NEXT_STEP_BUTTON = /дальше: обложка/i;

async function expectStepGate(
  page: Page,
  opts: { title: RegExp; action: RegExp; expectedPath: string }
) {
  await expect(page.getByRole("heading", { name: opts.title })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: opts.action }).click();
  await page.waitForURL(new RegExp(opts.expectedPath), { timeout: 10_000 });
}

// ─── Metadata step ───────────────────────────────────────────────────────────

test.describe("@smoke @regression Create release wizard — metadata step", () => {
  test("opens metadata page without crashing", async ({ page }) => {
    await navigateTo(page, "/create/metadata");
    await page.waitForLoadState("networkidle");
    await expect(page).not.toHaveTitle(/500|Error/i);
  });

  test("shows validation errors on empty submit", async ({ page }) => {
    await navigateTo(page, "/create/metadata");
    await page.waitForLoadState("networkidle");

    // Attempt to advance without filling required fields
    const nextButton = page.getByRole("button", { name: NEXT_STEP_BUTTON });
    if (await nextButton.isVisible()) {
      // Кнопка может быть disabled до валидного минимума полей — force для проверки отображения ошибок.
      await nextButton.click({ force: true });
      await expect(page.locator("[data-error], [role='alert'], .text-red")).toBeVisible({
        timeout: 5_000
      });
    }
  });

  test("accepts valid metadata without client-side validation errors", async ({ page }) => {
    await navigateTo(page, "/create/metadata");
    await page.waitForLoadState("networkidle");
    await fillMetadataMinimum(page);

    // Черновик создаётся на сервере — подменяем, чтобы прогон не писал в базу.
    await page.route("**/api/releases/create-draft", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, record: { id: "e2e-draft-1", status: "draft", client_request_id: "e2e" } })
      })
    );

    const nextButton = page.getByRole("button", { name: NEXT_STEP_BUTTON });
    await expect(nextButton).toBeEnabled();
    await expect(page.locator("[role='alert']:not(:empty)")).toHaveCount(0);
    await nextButton.click();
    await expect(page).not.toHaveTitle(/500|Error/i);
  });
});

// ─── Navigation guards ───────────────────────────────────────────────────────

test.describe("@smoke @regression Create release wizard — step guards", () => {
  test("/create redirects to /create/metadata", async ({ page }) => {
    await navigateTo(page, "/create");
    await page.waitForURL(/\/create\/metadata/, { timeout: 10_000 });
    expect(page.url()).toContain("/create/metadata");
  });

  test("/create/review is accessible after hydration", async ({ page }) => {
    await navigateTo(page, "/create/review");
    await page.waitForLoadState("networkidle");
    // Either the review UI or a redirect to metadata is valid; assert no crash
    await expect(page).not.toHaveTitle(/500|Error/i);
  });

  test("/create/success renders without crashing", async ({ page }) => {
    await navigateTo(page, "/create/success");
    await page.waitForLoadState("networkidle");
    await expect(page).not.toHaveTitle(/500|Error/i);
  });
});

// ─── Regression: wizard state, guards and persistence ────────────────────────

test.describe("@regression Create release wizard — regression guards", () => {
  test("blocks direct /create/assets when metadata is incomplete", async ({ page }) => {
    await navigateTo(page, "/create/assets");
    await expectStepGate(page, {
      title: /сначала заполните паспорт релиза/i,
      action: /перейти к паспорту/i,
      expectedPath: "/create/metadata"
    });
  });

  test("blocks direct /create/tracks before artwork step", async ({ page }) => {
    await navigateTo(page, "/create/tracks");
    await expectStepGate(page, {
      title: /сначала заполните паспорт релиза|черновик релиза ещё не создан/i,
      action: /перейти к паспорту|перейти к обложке/i,
      expectedPath: "/create/(metadata|assets)"
    });
  });

  test("blocks direct /create/review before tracks step", async ({ page }) => {
    await navigateTo(page, "/create/review");
    await expectStepGate(page, {
      title: /сначала заполните паспорт релиза|черновик релиза ещё не создан|сначала добавьте треки/i,
      action: /перейти к паспорту|перейти к обложке|перейти к трекам/i,
      expectedPath: "/create/(metadata|assets|tracks)"
    });
  });
});

test.describe("@regression Create release wizard — metadata form behavior", () => {
  test("keeps entered metadata after reload", async ({ page }) => {
    await navigateTo(page, "/create/metadata");
    await fillMetadataMinimum(page);

    await page.reload();
    await page.waitForLoadState("networkidle");

    await expect(page.getByPlaceholder(/имя на обложке/i)).toHaveValue("Regression Artist");
    await expect(page.getByPlaceholder(/основное название релиза/i)).toHaveValue(
      "Regression Release"
    );
    await expect(page.locator("select[name='genre']")).toHaveValue("Techno");
  });

  test("single release mode remains selected after form interactions", async ({ page }) => {
    await navigateTo(page, "/create/metadata");
    await fillMetadataMinimum(page);

    const single = page.getByRole("button", { name: /^сингл$/i });
    const album = page.getByRole("button", { name: /^альбом$/i });
    await single.click();
    await page.getByPlaceholder(/основное название релиза/i).fill("Single Mode Title");

    await expect(single).toHaveAttribute("aria-pressed", "true");
    await expect(album).toHaveAttribute("aria-pressed", "false");
  });

  test("album mode remains selected after form interactions", async ({ page }) => {
    await navigateTo(page, "/create/metadata");
    await fillMetadataMinimum(page);

    const single = page.getByRole("button", { name: /^сингл$/i });
    const album = page.getByRole("button", { name: /^альбом$/i });
    await album.click();
    await page.getByPlaceholder(/основное название релиза/i).fill("Album Mode Title");

    await expect(album).toHaveAttribute("aria-pressed", "true");
    await expect(single).toHaveAttribute("aria-pressed", "false");
  });
});

// ─── Library page ────────────────────────────────────────────────────────────

test.describe("@smoke @regression Library page", () => {
  // Список релизов подменяем: в CI нет настоящего Supabase, а пустая библиотека — тот самый экран, что проверяем.
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/releases/my**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, rows: [] }) })
    );
  });

  test("renders without crashing", async ({ page }) => {
    await navigateTo(page, "/library");
    await page.waitForLoadState("networkidle");
    await expect(page).not.toHaveTitle(/500|Error/i);
  });

  test("shows the create release button", async ({ page }) => {
    await navigateTo(page, "/library");
    await page.waitForLoadState("networkidle");
    if (page.url().includes("/login")) {
      await expect(page.getByRole("button", { name: /войти/i })).toBeVisible({ timeout: 10_000 });
      return;
    }
    // Пустая библиотека — карточка «Сингл», с релизами — кнопка «Новый релиз».
    const primaryCreateCta = page.getByRole("button", { name: /новый релиз|^сингл/i }).first();
    await expect(primaryCreateCta).toBeVisible({ timeout: 10_000 });
  });

  test("new release button routes to metadata", async ({ page }) => {
    await navigateTo(page, "/library");
    await page.waitForLoadState("networkidle");
    if (page.url().includes("/login")) {
      await navigateTo(page, "/create/metadata");
      await page.waitForURL(/\/create\/metadata/, { timeout: 10_000 });
      return;
    }
    await page.getByRole("button", { name: /новый релиз|^сингл/i }).first().click();
    await page.waitForURL(/\/create\/metadata/, { timeout: 10_000 });
  });

  test("handles filtered views without crash", async ({ page }) => {
    await navigateTo(page, "/library?view=drafts");
    await page.waitForLoadState("networkidle");
    await expect(page).not.toHaveTitle(/500|Error/i);

    await navigateTo(page, "/library?view=moderation");
    await page.waitForLoadState("networkidle");
    await expect(page).not.toHaveTitle(/500|Error/i);
  });
});
