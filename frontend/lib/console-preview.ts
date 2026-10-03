/** Explicit development-only fixture. Never a paid account or a real session. */
import type { Workspace } from "@/lib/workspace";

export const PREVIEW_WORKSPACE: Workspace = {
  organization: { id: "local-preview-xsom", name: "xSOM" },
  subscriptions: [
    { product: "secret_guard", status: "internal", edition: "Équipe", seats: null, ends_at: null },
    { product: "ai_guard", status: "internal", edition: "Gouvernance", seats: null, ends_at: null },
  ],
};

export function previewResponse(path: string): unknown | undefined {
  if (path === "v1/workspace") return PREVIEW_WORKSPACE;
  if (path === "v1/agents") return { customer: "xSOM", agents: [] };
  if (path === "v1/extensions/events") return { events: [], next_before: null };
  if (path === "v1/policy") return { yaml: "tools: []\ndefaults:\n  unknown_tool: deny\n", version: 0 };
  if (["v1/tools", "v1/approvals", "v1/audit", "v1/extensions/devices", "v1/developer-policies", "v1/clients", "v1/gateway-tokens", "v1/credentials", "v1/read-tokens", "v1/servers"].includes(path)) return [];
  return undefined;
}
