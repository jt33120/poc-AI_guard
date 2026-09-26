import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import type {
  ActionRequest,
  PolicyDecision,
} from "@xsom/developer-guard-policy";

const MAX_REPLY = 8192;

interface BridgeConfig {
  readonly socket: string;
  readonly nonce: string;
}

interface ApprovalReply {
  readonly approval_id: string;
  readonly status: "pending" | "approved" | "denied" | "expired" | "consumed";
}

function validConfig(value: unknown): value is BridgeConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const config = value as Record<string, unknown>;
  return typeof config.socket === "string" && typeof config.nonce === "string";
}

function validReply(value: unknown): value is ApprovalReply {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const reply = value as Record<string, unknown>;
  return (
    typeof reply.approval_id === "string" &&
    ["pending", "approved", "denied", "expired", "consumed"].includes(
      String(reply.status),
    )
  );
}

export function actionBinding(
  rawInput: string,
  decision: PolicyDecision,
): string | undefined {
  if (decision.policyId === undefined || decision.policyVersion === undefined)
    return undefined;
  return createHash("sha256")
    .update(
      `${decision.policyId}\u0000${decision.policyVersion}\u0000${rawInput}`,
    )
    .digest("hex");
}

function requestId(binding: string): string {
  return `${binding.slice(0, 8)}-${binding.slice(8, 12)}-${binding.slice(12, 16)}-${binding.slice(16, 20)}-${binding.slice(20, 32)}`;
}

async function config(storage: string): Promise<BridgeConfig | undefined> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(storage, "developer-guard-approval.json"), "utf8"),
    );
    return validConfig(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function bridge(
  storage: string,
  payload: Record<string, unknown>,
): Promise<ApprovalReply | undefined> {
  const local = await config(storage);
  if (local === undefined) return undefined;
  return new Promise((resolve) => {
    const socket = net.createConnection(local.socket);
    let body = "";
    const done = (result: ApprovalReply | undefined) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(3000, () => {
      done(undefined);
    });
    socket.on("error", () => {
      done(undefined);
    });
    socket.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > MAX_REPLY) {
        done(undefined);
        return;
      }
      const newline = body.indexOf("\n");
      if (newline < 0) return;
      try {
        const value: unknown = JSON.parse(body.slice(0, newline));
        done(validReply(value) ? value : undefined);
      } catch {
        done(undefined);
      }
    });
    socket.on("connect", () =>
      socket.write(`${JSON.stringify({ nonce: local.nonce, ...payload })}\n`),
    );
  });
}

export async function resolveApproval(
  storage: string,
  rawInput: string,
  request: ActionRequest,
  decision: PolicyDecision,
): Promise<"approved" | "pending" | "unavailable"> {
  const binding = actionBinding(rawInput, decision);
  if (
    binding === undefined ||
    decision.policyId === undefined ||
    decision.policyVersion === undefined
  )
    return "unavailable";
  const common = {
    policyId: decision.policyId,
    policyVersion: decision.policyVersion,
    actionBinding: binding,
  };
  const requested = await bridge(storage, {
    type: "request",
    ...common,
    requestId: requestId(binding),
    toolName: request.tool ?? "unknown",
    actionClass: request.actionClass,
  });
  if (requested?.status !== "approved")
    return requested === undefined ? "unavailable" : "pending";
  const consumed = await bridge(storage, {
    type: "consume",
    approvalId: requested.approval_id,
    ...common,
  });
  return consumed?.status === "consumed"
    ? "approved"
    : consumed === undefined
      ? "unavailable"
      : "pending";
}
