import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gatewayUrl } from "./gateway-client.js";

// Match the backend's bounded binary envelope; cleaned text remains capped at 1 MiB.
const MAX_BYTES = 16 * 1_048_576;
const ROUTES = new Set(["/v1/messages", "/v1/messages/count_tokens"]);

export interface GatewayBridge {
  baseUrl: string;
  close: () => Promise<void>;
}

/** Only loopback + a random capability; never a generic HTTP forward proxy. */
export async function startGatewayBridge(
  base: string,
  token: string,
): Promise<GatewayBridge> {
  const remote = gatewayUrl(base);
  const prefix = `/${randomBytes(32).toString("hex")}`;
  let authority = "";
  const server: Server = createServer((request, response) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, 120000);
    response.on("close", () => {
      clearTimeout(timer);
      controller.abort();
    });
    const handle = async (): Promise<void> => {
      if (
        request.headers.origin ||
        request.headers.host !== authority ||
        !request.url?.startsWith(`${prefix}/`)
      ) {
        response.writeHead(403).end();
        return;
      }
      const path = request.url.slice(prefix.length).split("?")[0] ?? "";
      if (request.method === "GET" && path === "/health") {
        response.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            protocol: "xsom-extension-gateway-v1",
            redaction: "required",
          }),
        );
        return;
      }
      if (request.method !== "POST" || !ROUTES.has(path)) {
        response.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(String(chunk));
        size += bytes.length;
        if (size > MAX_BYTES) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(bytes);
      }
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "X-Gateway-Token": token,
      };
      for (const name of [
        "authorization",
        "x-api-key",
        "anthropic-version",
        "anthropic-beta",
      ]) {
        const value = request.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      const upstream = await fetch(
        `${remote}/proxy/extension/anthropic${path}`,
        {
          method: "POST",
          headers,
          body: Buffer.concat(chunks),
          redirect: "error",
          signal: controller.signal,
        },
      );
      response.writeHead(upstream.status, {
        "content-type":
          upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      });
      if (upstream.body) {
        const reader = upstream.body.getReader();
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (!response.write(chunk.value))
              await once(response, "drain", { signal: controller.signal });
          }
        } finally {
          reader.releaseLock();
        }
      }
      response.end();
    };
    void handle()
      .catch(() => {
        if (!response.headersSent)
          response.writeHead(502, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: {
              type: "gateway_unavailable",
              message: "xSOM gateway unavailable; no direct fallback.",
            },
          }),
        );
      })
      .finally(() => {
        clearTimeout(timer);
      });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  authority = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseUrl: `http://${authority}${prefix}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
