import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  validateSignedPolicyDocument,
  verifyPolicySignature,
} from "@xsom/developer-guard-runner";
import { gatewayGetJson } from "./gateway-client.js";

interface PolicyEnvelope {
  readonly policy: Record<string, unknown>;
  readonly signature: string;
  readonly publicKey: string;
  readonly keyId: string;
}

function isEnvelope(value: unknown): value is PolicyEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const envelope = value as Record<string, unknown>;
  return (
    typeof envelope.signature === "string" &&
    typeof envelope.publicKey === "string" &&
    typeof envelope.keyId === "string" &&
    typeof envelope.policy === "object" &&
    envelope.policy !== null &&
    !Array.isArray(envelope.policy)
  );
}

export function policyPath(storage: string): string {
  return join(storage, "developer-policy.json");
}
export function policyKeyPath(storage: string): string {
  return join(storage, "developer-policy.pub");
}

export interface ManagedPolicySummary {
  readonly policyId: string;
  readonly version: number;
  readonly expiresAt: string;
  readonly minRunnerVersion?: string;
}

export async function readManagedPolicySummary(
  storage: string,
): Promise<ManagedPolicySummary | undefined> {
  try {
    const parsed = JSON.parse(await readFile(policyPath(storage), "utf8")) as {
      policy?: {
        policyId?: unknown;
        version?: unknown;
        expiresAt?: unknown;
        minRunnerVersion?: unknown;
      };
    };
    const policy = parsed.policy;
    if (
      typeof policy?.policyId !== "string" ||
      !Number.isSafeInteger(policy.version) ||
      typeof policy.expiresAt !== "string" ||
      (policy.minRunnerVersion !== undefined &&
        typeof policy.minRunnerVersion !== "string")
    )
      return undefined;
    return {
      policyId: policy.policyId,
      version: policy.version as number,
      expiresAt: policy.expiresAt,
      ...(policy.minRunnerVersion === undefined
        ? {}
        : { minRunnerVersion: policy.minRunnerVersion }),
    };
  } catch {
    return undefined;
  }
}

export async function storedPolicyKey(
  storage: string,
): Promise<string | undefined> {
  try {
    return (await readFile(policyKeyPath(storage), "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function storedPolicyVersion(
  storage: string,
): Promise<{ policyId: string; version: number } | undefined> {
  try {
    const parsed = JSON.parse(await readFile(policyPath(storage), "utf8")) as {
      policy?: { policyId?: unknown; version?: unknown };
    };
    return typeof parsed.policy?.policyId === "string" &&
      Number.isSafeInteger(parsed.policy.version)
      ? {
          policyId: parsed.policy.policyId,
          version: parsed.policy.version as number,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

export async function syncManagedPolicy(
  endpoint: string,
  token: string,
  storage: string,
  runnerVersion = "0.6.0",
): Promise<"assigned" | "none"> {
  const value = await gatewayGetJson(endpoint, token, "/v1/extension/policy");
  if (value === undefined) {
    // Keep the trust anchor when an assignment is withdrawn. Removing it would
    // let a later assignment silently establish a different key, which defeats
    // pinning. Key replacement is an explicit managed-device operation.
    await rm(policyPath(storage), { force: true });
    return "none";
  }
  if (
    !isEnvelope(value) ||
    !verifyPolicySignature(value.policy, value.signature, value.publicKey)
  )
    throw new Error("invalid_policy_envelope");
  const pinned = await storedPolicyKey(storage);
  if (pinned !== undefined && pinned !== value.publicKey)
    throw new Error("unexpected_policy_key_rotation");
  validateSignedPolicyDocument(value, pinned ?? value.publicKey, runnerVersion);
  const issuedAt = Date.parse(String(value.policy.issuedAt));
  const expiresAt = Date.parse(String(value.policy.expiresAt));
  const now = Date.now();
  if (!Number.isFinite(issuedAt) || issuedAt > now || expiresAt <= now)
    throw new Error("policy_not_current");
  const current = await storedPolicyVersion(storage);
  const incomingId = value.policy.policyId;
  const incomingVersion = value.policy.version;
  if (
    current !== undefined &&
    incomingId === current.policyId &&
    typeof incomingVersion === "number" &&
    incomingVersion < current.version
  )
    throw new Error("policy_version_downgrade");
  await mkdir(storage, { recursive: true });
  await writeFile(policyKeyPath(storage), `${value.publicKey}\n`, {
    mode: 0o600,
  });
  await writeFile(policyPath(storage), JSON.stringify(value), { mode: 0o600 });
  return "assigned";
}
