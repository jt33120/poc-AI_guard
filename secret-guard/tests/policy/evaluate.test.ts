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

  describe("resource prefixes", () => {
    const scoped = (prefix: string): DeveloperPolicy => ({
      ...policy,
      rules: [
        {
          id: "deny-scope",
          effect: "deny",
          match: { resourcePrefixes: [prefix] },
        },
      ],
      defaults: { unknownAction: "allow" },
    });
    const hits = (prefix: string, resource: string): boolean =>
      evaluatePolicy(
        scoped(prefix),
        {
          assistant: "claude",
          event: "read",
          actionClass: "read",
          capabilityVerified: true,
          resource,
        },
        new Date("2026-09-30T00:00:00Z"),
      ).matchedRuleIds.includes("deny-scope");

    it("matches the prefix itself and paths below it", () => {
      expect(hits("/repo/src", "/repo/src")).toBe(true);
      expect(hits("/repo/src", "/repo/src/a/b.ts")).toBe(true);
      expect(hits("/repo/src", "/repo/src/./a/../b.ts")).toBe(true);
    });

    it("ignores a trailing separator on the prefix", () => {
      expect(hits("/repo/src/", "/repo/src")).toBe(true);
      expect(hits("/repo/src/", "/repo/src/a.ts")).toBe(true);
      expect(hits("/repo/src", "/repo/src/")).toBe(true);
    });

    it("never matches a sibling that shares the prefix text", () => {
      expect(hits("/repo/src", "/repo/src-secrets")).toBe(false);
      expect(hits("/repo/src/", "/repo/src-secrets/key")).toBe(false);
    });

    it("never matches a path that escapes the prefix with ..", () => {
      expect(hits("/repo/src", "/repo/src/../../etc/passwd")).toBe(false);
      expect(hits("/repo/src", "/repo/src/../src-secrets")).toBe(false);
    });

    it("compares Windows drive paths case- and separator-insensitively", () => {
      expect(hits("C:\\Repo\\src", "c:/repo/src/a.ts")).toBe(true);
      expect(hits("c:/repo/src/", "C:\\REPO\\SRC")).toBe(true);
      expect(hits("C:\\Repo\\src", "C:\\Repo\\src-secrets")).toBe(false);
      expect(hits("C:\\Repo\\src", "C:\\Repo\\src\\..\\..\\Windows")).toBe(
        false,
      );
      expect(hits("C:\\Repo\\src", "D:\\Repo\\src\\a.ts")).toBe(false);
    });

    it("covers the whole tree from a root prefix", () => {
      expect(hits("/", "/etc/passwd")).toBe(true);
    });

    it("matches identifiers literally and never against path prefixes", () => {
      expect(
        hits("https://api.example.com/v1", "https://api.example.com/v1/x"),
      ).toBe(true);
      expect(
        hits("https://api.example.com/v1", "https://api.example.com/v1-admin"),
      ).toBe(false);
      expect(hits("/repo", "https://api.example.com/repo")).toBe(false);
      expect(hits("https://api.example.com", "/repo/a.ts")).toBe(false);
    });
  });

  it("keeps allowed roots on segment boundaries", () => {
    expect(
      evaluateResource("/workspace-other/a.ts", ["/workspace"]),
    ).toMatchObject({ allowed: false, reason: "outside_allowed_roots" });
    expect(evaluateResource("C:/Work/a.ts", ["c:\\work"])).toMatchObject({
      allowed: true,
    });
  });
});
