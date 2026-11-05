import { test, expect, type Page, type Route } from "@playwright/test";
import { blockBackendWrites } from "./helpers/block-writes";

const DEV_USER_ID = "1";
const BASE_PARAMS = `?devUserId=${DEV_USER_ID}`;

test.beforeEach(async ({ page }) => {
  await blockBackendWrites(page);
});

const STORE_KEY = "omf_create_release_draft_v2";

type ReleaseMock = {
  id: string;
  status: string;
  artist_name: string;
  track_name: string;
  artwork_url: string | null;
  collaborators: string | null;
  error_message: string | null;
};

async function navigateTo(page: Page, path: string) {
  await page.goto(`${path}${BASE_PARAMS}`);
}

async function seedReviewReadyState(page: Page) {
  const releaseId = "release-e2e-1";
  await page.addInitScript(
    ({ key, releaseIdValue }) => {
      const state = {
        userId: "1",
        telegramName: "Regression User",
        telegramUsername: "regression",
        releaseId: releaseIdValue,
        clientRequestId: "client-req-1",
        metadata: {
          primaryArtist: "Regression Artist",
          releaseTitle: "Regression Release",
          language: "RU",
          explicit: false,
          genre: "Techno",
          releaseType: "single",
          releaseDate: "2099-12-31",
          label: "OMF",
          authorFullName: "Регрессов Тест Тестович",
          musicAuthor: "Regression Beatmaker",
          licenseType: "own",
          tiktokStart: "0:45"
        },
        artworkUrl: "https://e2e.supabase.co/storage/v1/object/public/artwork/1/e2e/cover.png",
        tracks: [{ title: "Regression Track", explicit: false, lyrics: "", featuringArtistNames: [] }],
        trackAudioUrlsFromDb: ["https://example.com/audio.wav"],
        releaseArtistLinks: {},
        lastModified: Date.now(),
        successSummary: null,
        hasHydrated: true
      };
      window.localStorage.setItem(key, JSON.stringify({ state, version: 0 }));
    },
    { key: STORE_KEY, releaseIdValue: releaseId }
  );
}

/**
 * Мок API владельца релиза (`/api/releases/*`). Клиент больше не ходит в `/rest/v1/releases|tracks`
 * напрямую — RLS не доверяет заголовку x-telegram-user-id.
 */
async function mockReleaseOwnerApi(route: Route, release: ReleaseMock) {
  const req = route.request();
  const method = req.method();
  const { pathname, searchParams } = new URL(req.url());
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  if (pathname === `/api/releases/${release.id}` && method === "GET") {
    const tracks = [
      {
        release_id: release.id,
        index: 0,
        title: "Regression Track",
        explicit: false,
        file_path: "https://example.com/audio.wav",
        lyrics: ""
      }
    ];
    await json(searchParams.get("tracks") === "1" ? { ok: true, record: release, tracks } : { ok: true, record: release });
    return;
  }

  if (pathname === "/api/releases/save-draft-patch" && method === "POST") {
    const body = (req.postDataJSON() as { patch?: Record<string, unknown> } | null) ?? {};
    Object.assign(release, body.patch ?? {});
    await json({ ok: true, record: release });
    return;
  }

  if (pathname === "/api/releases/tracks") {
    await json({ ok: true });
    return;
  }

  if (pathname === "/api/releases/mark-failed" && method === "POST") {
    release.status = "failed";
    await json({ ok: true, record: release });
    return;
  }

  await route.continue();
}

test.describe("@full-submit Create release submit full-flow with mocked backend", () => {
  test("submits from review and reaches success screen", async ({ page }) => {
    const release: ReleaseMock = {
      id: "release-e2e-1",
      status: "draft",
      artist_name: "Regression Artist",
      track_name: "Regression Release",
      artwork_url: "https://e2e.supabase.co/storage/v1/object/public/artwork/1/e2e/cover.png",
      collaborators: null,
      error_message: null
    };

    await seedReviewReadyState(page);

    await page.route("**/api/releases/**", async (route) => {
      await mockReleaseOwnerApi(route, release);
    });

    await page.route("**/api/releases/submit-precheck", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true })
      });
    });

    await page.route("**/api/releases/finalize-submit", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          record: {
            ...release,
            status: "processing"
          }
        })
      });
    });

    await navigateTo(page, "/create/review");
    await page.getByRole("checkbox", { name: /пропаганды наркотиков/i }).check();
    await page.getByRole("checkbox", { name: /выпуск платный/i }).check();
    await page.getByRole("button", { name: /отправить на проверку/i }).click();

    await page.waitForURL(/\/create\/success/, { timeout: 15_000 });
    await expect(page.getByText(/отправлено на проверку/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /к моим релизам/i })).toBeVisible();
  });

  test("shows precheck error and stays on review", async ({ page }) => {
    const release: ReleaseMock = {
      id: "release-e2e-1",
      status: "draft",
      artist_name: "Regression Artist",
      track_name: "Regression Release",
      artwork_url: "https://e2e.supabase.co/storage/v1/object/public/artwork/1/e2e/cover.png",
      collaborators: null,
      error_message: null
    };

    await seedReviewReadyState(page);

    await page.route("**/api/releases/**", async (route) => {
      await mockReleaseOwnerApi(route, release);
    });

    await page.route("**/api/releases/submit-precheck", async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: "Пре-чек не пройден: не совпадает число треков."
        })
      });
    });

    // finalize should never be called in this branch
    await page.route("**/api/releases/finalize-submit", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "should not be called" })
      });
    });

    await navigateTo(page, "/create/review");
    await page.getByRole("checkbox", { name: /пропаганды наркотиков/i }).check();
    await page.getByRole("checkbox", { name: /выпуск платный/i }).check();
    await page.getByRole("button", { name: /отправить на проверку/i }).click();

    await expect(page).toHaveURL(/\/create\/review/, { timeout: 10_000 });
    await expect(page.getByText(/пре-чек не пройден/i).first()).toBeVisible({ timeout: 10_000 });
  });
});

