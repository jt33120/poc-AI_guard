import { expect, type Page, test } from "@playwright/test";

async function prepareConsole(page: Page) {
  await page.context().addCookies([
    { name: "xsom_e2e", value: "1", url: "http://127.0.0.1:3100" },
  ]);
  await page.route("**/api/control/**", async (route) => route.fulfill({ json: [] }));
}

test("reduced motion keeps the onboarding video on its poster without downloading media", async ({ page }) => {
  await prepareConsole(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    if (/\.(webm|mp4)(\?|$)/.test(request.url())) mediaRequests.push(request.url());
  });
  await page.goto("/onboarding");
  const player = page.locator("signal-video");
  const video = player.locator("video");
  await player.hover();
  await expect(video).toHaveAttribute("preload", "none");
  await expect(video).toHaveAttribute("poster", /guarded\.webp$/);
  await expect(player.getByRole("button", { name: "Lire la séquence", exact: true })).toBeDisabled();
  await expect(video).toHaveJSProperty("paused", true);
  await expect(player.locator("source[src]")).toHaveCount(0);
  await player.getByRole("button", { name: "Voir la policy", exact: true }).click();
  await expect(player.locator(".signal-video__stage")).toHaveAttribute("data-layer", "policy");
  expect(mediaRequests).toEqual([]);
});

test("video hover freezes on leave and guarded mode switches both scene and poster", async ({ page }) => {
  await prepareConsole(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/onboarding");
  const player = page.locator("signal-video");
  const video = player.locator("video");
  await expect(video).toHaveAttribute("poster", /guarded\.webp$/);
  await expect(player.locator("source[src]")).toHaveCount(0);
  await player.hover();
  await expect(video).toHaveJSProperty("paused", false);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  await page.mouse.move(1, 1);
  await expect(video).toHaveJSProperty("paused", true);

  await player.getByRole("button", { name: "Guarded", exact: true }).click();
  await expect(video).toHaveAttribute("poster", /unguarded\.webp$/);
  await expect(player.locator('source[type="video/webm"]')).toHaveAttribute("data-src", /unguarded\.webm$/);
  await expect(player.locator('source[type="video/mp4"]')).toHaveAttribute("data-src", /unguarded\.mp4$/);
  await player.getByRole("button", { name: "Lire la séquence", exact: true }).click();
  await expect(video).toHaveJSProperty("paused", false);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentSrc)).toMatch(/unguarded\.(webm|mp4)$/);
  await player.getByRole("button", { name: "Voir la policy", exact: true }).click();
  await expect(player.locator(".signal-video__stage")).toHaveAttribute("data-layer", "policy");
});

test("audit metadata remains text, and filtering live events never inserts demo evidence", async ({ page }) => {
  await prepareConsole(page);
  const label = '<img src="/__signal_probe__" onerror="window.__signalXss=true">';
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/__signal_probe__")) requests.push(request.url());
  });
  await page.route("**/api/control/v1/audit**", async (route) => route.fulfill({
    json: [{ id: 714, ts: "2026-09-10T12:00:00Z", tool_name: label, decision: "deny", args_hash: "demo-args-hash" }],
  }));
  await page.goto("/audit");
  const chain = page.locator('signal-audit[mode="live"]');
  await expect(chain.getByText(label, { exact: true })).toBeVisible();
  await expect(chain.locator("img,script,iframe")).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.getByRole("searchbox", { name: "Rechercher", exact: true }).fill("not-in-the-audit");
  await expect(chain.getByText("Aucun événement à inspecter.", { exact: true })).toBeVisible();
  await expect(chain.locator(".signal-audit__event")).toHaveCount(0);
  await expect(chain.getByText(/demo-00|Démonstration/)).toHaveCount(0);
});
