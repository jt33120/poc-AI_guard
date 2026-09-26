import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  evaluatePolicy,
  evaluateResource,
  type ActionRequest,
  type DeveloperPolicy,
} from "../../packages/policy/src/index.js";

const policy = {
  schemaVersion: 1 as const,
  policyId: "team-default",
  version: 3,
  issuedAt: "2026-09-22T10:00:00Z",
  expiresAt: "2026-10-22T10:00:00Z",
  defaults: { unknownAction: "deny" as const },
  rules: [
    {
      id: "allow-read",
      effect: "allow" as const,
      match: { actionClasses: ["read" as const] },
    },
    {
      id: "approval-publish",
      effect: "require_approval" as const,
      match: { actionClasses: ["publish" as const] },
    },
    {
      id: "deny-private",
      effect: "deny" as const,
      match: { resourcePrefixes: ["/private/"] },
    },
  ],
};

describe("developer policy evaluation", () => {
  it("matches the shared Python/TypeScript contract vectors", () => {
    const fixture = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            "../../contracts/fixtures/policy-vectors.json",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    ) as {
      policy: DeveloperPolicy;
      vectors: { name: string; request: ActionRequest; effect: string }[];
    };
    for (const vector of fixture.vectors)
      expect(
        evaluatePolicy(
          fixture.policy,
          vector.request,
          new Date("2026-09-22T00:00:00Z"),
        ).effect,
        vector.name,
      ).toBe(vector.effect);
  });
  it("uses the strictest matching effect and never grants an unverified action", () => {
    expect(
      evaluatePolicy(policy, {
        assistant: "codex",
        event: "read",
        actionClass: "read",
        capabilityVerified: true,
      }),
    ).toMatchObject({ effect: "allow", matchedRuleIds: ["allow-read"] });
    expect(
      evaluatePolicy(policy, {
        assistant: "codex",
        event: "command",
        actionClass: "publish",
        capabilityVerified: true,
      }),
    ).toMatchObject({ effect: "require_approval" });
    expect(
      evaluatePolicy(policy, {
        assistant: "copilot",
        event: "command",
        actionClass: "publish",
        capabilityVerified: false,
      }),
    ).toMatchObject({ effect: "deny", reason: "host_capability_unverified" });
  });

  it("rejects expired policies and sensitive or out-of-scope resources", () => {
    expect(
      evaluatePolicy(
        { ...policy, expiresAt: "2020-01-01T00:00:00Z" },
        {
          assistant: "claude",
          event: "read",
          actionClass: "read",
          capabilityVerified: true,
        },
      ),
    ).toMatchObject({ effect: "deny", reason: "policy_invalid_or_expired" });
    expect(
      evaluatePolicy(
        {
          ...policy,
          issuedAt: "2031-01-01T00:00:00Z",
          expiresAt: "2032-01-01T00:00:00Z",
        },
        {
          assistant: "claude",
          event: "read",
          actionClass: "read",
          capabilityVerified: true,
        },
        new Date("2030-01-01T00:00:00Z"),
      ),
    ).toMatchObject({ effect: "deny", reason: "policy_invalid_or_expired" });
    expect(evaluateResource("/workspace/.env")).toMatchObject({
      allowed: false,
      reason: "sensitive_resource",
    });
    expect(evaluateResource("/other/file.ts", ["/workspace"])).toMatchObject({
      allowed: false,
      reason: "outside_allowed_roots",
    });
  });
});
