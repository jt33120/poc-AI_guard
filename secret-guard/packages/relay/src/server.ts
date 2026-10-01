import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import {
  createCleaner,
  MAX_REQUEST_BYTES,
  type CleanOptions,
  type RefusalReason,
} from "./clean.js";

export const RELAY_PROTOCOL = "xsom-local-redaction-v1";
/** Fixed destination: the local relay cannot be pointed anywhere else. */
export const ANTHROPIC_API = "https://api.anthropic.com";

const ROUTES = new Map([
  ["/v1/messages", "messages"],
  ["/v1/messages/count_tokens", "count_tokens"],
] as const);
// Credentials travel in memory only: never stored, logged or reported.
const REQUEST_HEADERS = [
  "authorization",
  "x-api-key",
  "anthropic-version",
  "anthropic-beta",
  "user-agent",
];
const RESPONSE_HEADERS = ["content-type", "retry-after", "request-id"];
const UPSTREAM_HEADERS_TIMEOUT_MS = 300_000;

export type RelayRoute = "messages" | "count_tokens";

/** One request's outcome: counts and types only, never content or credentials. */
export interface RelayEvent {
  readonly route: RelayRoute;
  readonly outcome: "forwarded" | "refused" | "upstream_unavailable";
  readonly redactions: number;
  readonly kinds: readonly string[];
  readonly unanalysed: number;
  readonly reason?: RefusalReason;
}

export interface RelayOptions extends CleanOptions {
  readonly onEvent?: (event: RelayEvent) => void;
  /** Test seam for the upstream call; the destination itself stays fixed. */
  readonly fetch?: typeof fetch;
}

export interface LocalRelay {
  /** Value for ANTHROPIC_BASE_URL: loopback plus a 256-bit capability. */
  readonly baseUrl: string;
  close: () => Promise<void>;
}

const REFUSAL_MESSAGES: Record<RefusalReason, string> = {
  request_too_large: "la requête dépasse la taille que le relais sait analyser",
  invalid_json: "la requête n'est pas un JSON valide",
  messages_required: "la requête ne contient pas de messages",
  request_too_deep: "la requête est trop imbriquée pour être analysée",
  scan_incomplete: "un texte n'a pas pu être analysé entièrement",
  redaction_incomplete: "un secret n'a pas pu être retiré entièrement",
  secret_in_protocol_identifier:
    "un identifiant technique de la conversation contient un secret",
  secret_in_signed_thinking:
    "un raisonnement signé du modèle contient un secret et ne peut pas être modifié",
  signed_thinking_unreadable: "un raisonnement signé du modèle est illisible",
  unanalysed_attachment:
    "la requête contient une image ou un document que Secret Guard ne sait pas analyser",
};

function sendError(
  response: ServerResponse,
  status: number,
  type: string,
  message: string,
): void {
  if (!response.headersSent)
    response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ type: "error", error: { type, message } }));
}

function refuse(response: ServerResponse, reason: RefusalReason): void {
  sendError(
    response,
    reason === "request_too_large" ? 413 : 400,
    "invalid_request_error",
    `Secret Guard a refusé l'envoi : ${REFUSAL_MESSAGES[reason]}. Rien n'a été transmis.`,
  );
}

/** Reads the body, or returns undefined once it exceeds the ceiling. */
async function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;
    if (size > MAX_REQUEST_BYTES) return undefined;
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function upstreamHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  for (const name of REQUEST_HEADERS) {
    const value = request.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  return headers;
}

async function pipeBody(
  upstream: Response,
  response: ServerResponse,
  signal: AbortSignal,
): Promise<void> {
  if (!upstream.body) return;
  const reader = upstream.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return;
      if (!response.write(chunk.value))
        await once(response, "drain", { signal });
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Starts the relay on loopback. Each request to an Anthropic Messages route is
 * cleaned locally, then sent to the fixed Anthropic address; the response is
 * streamed back unchanged. There is no direct fallback.
 */
export async function startLocalRelay(
  options: RelayOptions = {},
): Promise<LocalRelay> {
  const upstreamFetch = options.fetch ?? fetch;
  const cleaner = createCleaner(options);
  const prefix = `/${randomBytes(32).toString("hex")}`;
  let authority = "";

  const forward = async (
    request: IncomingMessage,
    response: ServerResponse,
    route: RelayRoute,
    target: string,
  ): Promise<void> => {
    const body = await readBody(request);
    const cleaned =
      body === undefined
        ? ({ ok: false, reason: "request_too_large" } as const)
        : cleaner.clean(body);
    if (!cleaned.ok) {
      options.onEvent?.({
        route,
        outcome: "refused",
        redactions: 0,
        kinds: [],
        unanalysed: 0,
        reason: cleaned.reason,
      });
      refuse(response, cleaned.reason);
      return;
    }
    const report = (outcome: RelayEvent["outcome"]): void =>
      options.onEvent?.({
        route,
        outcome,
        redactions: cleaned.redactions,
        kinds: cleaned.kinds,
        unanalysed: cleaned.unanalysed,
      });
    const controller = new AbortController();
    response.on("close", () => {
      controller.abort();
    });
    const timer = setTimeout(() => {
      controller.abort();
    }, UPSTREAM_HEADERS_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await upstreamFetch(target, {
        method: "POST",
        headers: upstreamHeaders(request),
        body: new Uint8Array(cleaned.body),
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      report("upstream_unavailable");
      sendError(
        response,
        502,
        "api_error",
        "Secret Guard : Anthropic est injoignable depuis le relais local. Aucun envoi direct de secours n'a été fait.",
      );
      return;
    } finally {
      clearTimeout(timer);
    }
    report("forwarded");
    const headers: Record<string, string> = { "cache-control": "no-store" };
    for (const name of RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    response.writeHead(upstream.status, headers);
    await pipeBody(upstream, response, controller.signal);
    response.end();
  };

  const handle = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    if (
      request.headers.origin !== undefined ||
      request.headers.host !== authority ||
      !request.url?.startsWith(`${prefix}/`)
    ) {
      response.writeHead(403).end();
      return;
    }
    const rest = request.url.slice(prefix.length);
    const queryAt = rest.indexOf("?");
    const path = queryAt === -1 ? rest : rest.slice(0, queryAt);
    const query = queryAt === -1 ? "" : rest.slice(queryAt);
    if (request.method === "GET" && path === "/health") {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(
          JSON.stringify({ protocol: RELAY_PROTOCOL, redaction: "required" }),
        );
      return;
    }
    const route = ROUTES.get(path as "/v1/messages");
    if (request.method !== "POST" || route === undefined) {
      response.writeHead(404).end();
      return;
    }
    await forward(request, response, route, `${ANTHROPIC_API}${path}${query}`);
  };

  const server: Server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent)
        sendError(
          response,
          502,
          "api_error",
          "Secret Guard : relais interrompu.",
        );
      else response.destroy();
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
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
