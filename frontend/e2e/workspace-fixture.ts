import type { Page } from "@playwright/test";
import type { Workspace } from "../lib/workspace";

export const WORKSPACE: Workspace = {
  organization: { id: "test-xsom", name: "xSOM" },
  subscriptions: [
    { product: "secret_guard", status: "internal", edition: "Équipe", seats: null, ends_at: null },
    { product: "ai_guard", status: "internal", edition: "Gouvernance", seats: null, ends_at: null },
  ],
};
export async function mockWorkspace(page: Page, workspace = WORKSPACE) {
  await page.route("**/api/control/v1/workspace", (route) => route.fulfill({ json: workspace }));
}
