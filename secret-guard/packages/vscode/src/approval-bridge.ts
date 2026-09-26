import { createHash, randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import process from "node:process";
import { join } from "node:path";
import { gatewayJson } from "./gateway-client.js";

const MAX_REQUEST = 8192;
const ACTION_BINDING = /^[a-f0-9]{64}$/;

interface RequestBody {
  readonly nonce?: unknown;
  readonly type?: unknown;
  readonly requestId?: unknown;
  readonly approvalId?: unknown;
  readonly policyId?: unknown;
  readonly policyVersion?: unknown;
  readonly actionBinding?: unknown;
  readonly toolName?: unknown;
  readonly actionClass?: unknown;
}

export interface ApprovalBridge {
  close(): Promise<void>;
}

function socketPath(storage: string): string {
  const id = createHash("sha256").update(storage).digest("hex").slice(0, 24);
  return process.platform === "win32"
    ? `\\\\.\\pipe\\xsom-developer-guard-${id}`
    : join(storage, "developer-guard-approval.sock");
}

function validCommon(body: RequestBody): boolean {
  return (
    typeof body.policyId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(body.policyId) &&
    typeof body.policyVersion === "number" &&
    Number.isInteger(body.policyVersion) &&
    body.policyVersion >= 1 &&
    typeof body.actionBinding === "string" &&
    ACTION_BINDING.test(body.actionBinding)
  );
}

function write(socket: net.Socket, body: unknown): void {
  socket.end(`${JSON.stringify(body)}\n`);
}

export async function startApprovalBridge(
  storage: string,
  endpoint: string,
  gatewayToken: string,
): Promise<ApprovalBridge> {
  await mkdir(storage, { recursive: true });
  const socket = socketPath(storage);
  if (process.platform !== "win32") await rm(socket, { force: true });
  const nonce = randomBytes(32).toString("base64url");
  const server = net.createServer((connection) => {
    let input = "";
    connection.setTimeout(3000, () => {
      connection.destroy();
    });
    connection.on("data", (chunk: Buffer) => {
      input += chunk.toString("utf8");
      if (input.length > MAX_REQUEST) {
        connection.destroy();
        return;
      }
      const newline = input.indexOf("\n");
      if (newline < 0) return;
      void (async () => {
        try {
          const body: RequestBody = JSON.parse(input.slice(0, newline));
          if (body.nonce !== nonce || !validCommon(body)) {
            write(connection, { error: "denied" });
            return;
          }
          if (body.type === "request") {
            if (
              typeof body.requestId !== "string" ||
              typeof body.toolName !== "string" ||
              !/^[A-Za-z0-9._-]{1,128}$/.test(body.toolName) ||
              typeof body.actionClass !== "string"
            ) {
              write(connection, { error: "invalid" });
              return;
            }
            write(
              connection,
              await gatewayJson(
                endpoint,
                gatewayToken,
                "/v1/extension/approvals/request",
                {
                  requestId: body.requestId,
                  policyId: body.policyId,
                  policyVersion: body.policyVersion,
                  actionBinding: body.actionBinding,
                  toolName: body.toolName,
                  actionClass: body.actionClass,
                },
              ),
            );
            return;
          }
          if (body.type === "consume" && typeof body.approvalId === "string") {
            write(
              connection,
              await gatewayJson(
                endpoint,
                gatewayToken,
                `/v1/extension/approvals/${encodeURIComponent(body.approvalId)}/consume`,
                {
                  policyId: body.policyId,
                  policyVersion: body.policyVersion,
                  actionBinding: body.actionBinding,
                },
              ),
            );
            return;
          }
          write(connection, { error: "invalid" });
        } catch {
          write(connection, { error: "unavailable" });
        }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, () => {
      server.off("error", reject);
      resolve();
    });
  });
  await writeFile(
    join(storage, "developer-guard-approval.json"),
    JSON.stringify({ socket, nonce }),
    { mode: 0o600 },
  );
  return {
    async close(): Promise<void> {
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
      await Promise.all([
        rm(join(storage, "developer-guard-approval.json"), { force: true }),
        process.platform === "win32"
          ? Promise.resolve()
          : rm(socket, { force: true }),
      ]);
    },
  };
}
