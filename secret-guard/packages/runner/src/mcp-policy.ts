import { createHash } from "node:crypto";

export interface McpToolIdentity {
  readonly server: string;
  readonly tool: string;
  readonly schema: unknown;
}

export function mcpToolFingerprint(identity: McpToolIdentity): string {
  return createHash("sha256")
    .update(JSON.stringify([identity.server, identity.tool, identity.schema]))
    .digest("hex");
}

export function mcpToolAllowed(
  identity: McpToolIdentity,
  approvedFingerprints: readonly string[],
): boolean {
  return approvedFingerprints.includes(mcpToolFingerprint(identity));
}
