import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
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

const SOCKET_NAME = "approval.sock";
// Placeholder with the length of a mkdtemp directory name ("xsg-" + 6 chars).
const TEMPORARY_NAME_SAMPLE = "xsg-XXXXXX";

/**
 * Longest usable Unix socket path, in bytes: `sun_path` holds 104 bytes on
 * macOS and the BSDs, 108 on Linux, terminating NUL included. A longer path
 * makes `listen` fail with EINVAL, which disabled approvals on macOS.
 */
export function unixSocketPathLimit(
  platform: NodeJS.Platform = process.platform,
): number {
  return platform === "linux" ? 107 : 103;
}

export function fitsUnixSocket(
  path: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return Buffer.byteLength(path, "utf8") <= unixSocketPathLimit(platform);
}

export interface SocketLocation {
  readonly socket: string;
  /** Private directory holding the socket, removed on close when temporary. */
  readonly directory: string;
  readonly temporary: boolean;
}

// Only this user may traverse the directory: other local accounts can neither
// reach the socket nor replace it, whatever the socket file's own mode.
async function assertPrivateDirectory(directory: string): Promise<void> {
  await chmod(directory, 0o700);
  const status = await lstat(directory);
  const owner = process.getuid?.();
  if (
    !status.isDirectory() ||
    status.isSymbolicLink() ||
    (status.mode & 0o077) !== 0 ||
    (owner !== undefined && status.uid !== owner)
  )
    throw new Error("approval_socket_directory_not_private");
}

/**
 * A short, private place for the approval socket. The extension storage is
 * used when the resulting path fits `sun_path`; otherwise a fresh 0700
 * directory is created under the first short enough temporary base. Windows
 * uses a named pipe and never reaches this function.
 */
export async function approvalSocketLocation(
  storage: string,
  temporaryBases: readonly string[] = [tmpdir(), "/tmp"],
  platform: NodeJS.Platform = process.platform,
): Promise<SocketLocation> {
  const own = join(storage, "ipc");
  if (fitsUnixSocket(join(own, SOCKET_NAME), platform)) {
    await mkdir(own, { recursive: true, mode: 0o700 });
    await assertPrivateDirectory(own);
    return { socket: join(own, SOCKET_NAME), directory: own, temporary: false };
  }
  for (const base of temporaryBases) {
    if (
      !fitsUnixSocket(join(base, TEMPORARY_NAME_SAMPLE, SOCKET_NAME), platform)
    )
      continue;
    // mkdtemp creates a new, unpredictable directory with mode 0700.
    const directory = await mkdtemp(join(base, "xsg-"));
    await assertPrivateDirectory(directory);
    return {
      socket: join(directory, SOCKET_NAME),
      directory,
      temporary: true,
    };
  }
  throw new Error("approval_socket_path_too_long");
}

async function socketLocation(storage: string): Promise<SocketLocation> {
  if (process.platform !== "win32") return approvalSocketLocation(storage);
  const id = createHash("sha256").update(storage).digest("hex").slice(0, 24);
  return {
    socket: `\\\\.\\pipe\\xsom-developer-guard-${id}`,
    directory: storage,
    temporary: false,
  };
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
  const location = await socketLocation(storage);
  const { socket } = location;
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
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socket, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    if (location.temporary)
      await rm(location.directory, { recursive: true, force: true });
    throw error;
  }
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
          : location.temporary
            ? rm(location.directory, { recursive: true, force: true })
            : rm(socket, { force: true }),
      ]);
    },
  };
}
