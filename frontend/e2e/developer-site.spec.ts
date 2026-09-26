import { expect, test } from "@playwright/test";

test("retired Developer Guard pages are no longer public routes", async ({ request }) => {
  for (const path of ["/developpeurs", "/developpeurs/tarifs", "/developpeurs/securite", "/developpeurs/confiance"]) {
    expect((await request.get(path)).status()).toBe(404);
  }
});
