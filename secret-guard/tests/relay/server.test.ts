import { request as httpRequest } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_REQUEST_BYTES,
  RELAY_PROTOCOL,
  startLocalRelay,
  type LocalRelay,
  type RelayEvent,
  type RelayOptions,
} from "../../packages/relay/src/index";

const SECRET = `ghp_${"Ab3".repeat(12)}`;
const CREDENTIAL = "Bearer sk-ant-oat01-test-credential";

interface Call {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

let relay: LocalRelay | undefined;

afterEach(async () => {
  await relay?.close();
  relay = undefined;
});

function fakeUpstream(
  respond: () => Response = () => Response.json({ ok: 1 }),
) {
  const calls: Call[] = [];
  const fake: typeof fetch = (input, init) => {
    calls.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      body: Buffer.from(init?.body as Buffer).toString("utf8"),
    });
    return Promise.resolve(respond());
  };
  return { calls, fetch: fake };
}

async function start(options: RelayOptions): Promise<LocalRelay> {
  relay = await startLocalRelay(options);
  return relay;
}

function post(
  url: string,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: CREDENTIAL,
      "anthropic-version": "2023-06-01",
      ...headers,
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

const PROMPT = {
  model: "claude-test",
  max_tokens: 16,
  messages: [{ role: "user", content: `token ${SECRET}` }],
};

/** Raw HTTP, so a test can set Host and Origin the way a browser would. */
function raw(
  base: string,
  path: string,
  headers: Record<string, string>,
): Promise<number> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        path: `${url.pathname}${path}`,
        method: "GET",
        headers,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

describe("local relay", () => {
  it("cleans the request, then sends it to Anthropic with the credentials", async () => {
    const upstream = fakeUpstream();
    const events: RelayEvent[] = [];
    const { baseUrl } = await start({
      fetch: upstream.fetch,
      onEvent: (event) => events.push(event),
    });
    const response = await post(`${baseUrl}/v1/messages?beta=true`, PROMPT);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: 1 });
    expect(upstream.calls).toHaveLength(1);
    const [call] = upstream.calls;
    expect(call!.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(call!.body).not.toContain(SECRET);
    expect(call!.body).toContain("<REDACTED_");
    expect(call!.headers.authorization).toBe(CREDENTIAL);
    expect(call!.headers["anthropic-version"]).toBe("2023-06-01");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      route: "messages",
      outcome: "forwarded",
    });
    expect(events[0]!.redactions).toBeGreaterThan(0);
    const reported = JSON.stringify(events);
    expect(reported).not.toContain(SECRET);
    expect(reported).not.toContain(CREDENTIAL);
  });

  it("cleans count_tokens too, so counting never leaks the secret", async () => {
    const upstream = fakeUpstream();
    const { baseUrl } = await start({ fetch: upstream.fetch });
    await post(`${baseUrl}/v1/messages/count_tokens`, PROMPT);
    expect(upstream.calls[0]!.url).toBe(
      "https://api.anthropic.com/v1/messages/count_tokens",
    );
    expect(upstream.calls[0]!.body).not.toContain(SECRET);
  });

  it("streams the provider's answer back unchanged", async () => {
    const chunks = [
      "event: message_start\ndata: {}\n\n",
      'event: content_block_delta\ndata: {"text":"Bon"}\n\n',
      "event: message_stop\ndata: {}\n\n",
    ];
    const upstream = fakeUpstream(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of chunks)
                controller.enqueue(new TextEncoder().encode(chunk));
              controller.close();
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
              "request-id": "req_1",
            },
          },
        ),
    );
    const { baseUrl } = await start({ fetch: upstream.fetch });
    const response = await post(`${baseUrl}/v1/messages`, {
      ...PROMPT,
      stream: true,
    });
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("request-id")).toBe("req_1");
    expect(await response.text()).toBe(chunks.join(""));
  });

  it("relays the provider's errors as they are", async () => {
    const upstream = fakeUpstream(
      () =>
        new Response('{"type":"error"}', {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "7" },
        }),
    );
    const { baseUrl } = await start({ fetch: upstream.fetch });
    const response = await post(`${baseUrl}/v1/messages`, PROMPT);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
  });

  it("refuses with a readable Anthropic error and sends nothing", async () => {
    const upstream = fakeUpstream();
    const events: RelayEvent[] = [];
    const { baseUrl } = await start({
      fetch: upstream.fetch,
      onEvent: (event) => events.push(event),
    });
    const response = await post(`${baseUrl}/v1/messages`, {
      ...PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", data: "AA==" } },
          ],
        },
      ],
    });
    expect(response.status).toBe(400);
    const error = (await response.json()) as {
      type: string;
      error: { type: string; message: string };
    };
    expect(error.type).toBe("error");
    expect(error.error.type).toBe("invalid_request_error");
    expect(error.error.message).toContain("Secret Guard a refusé l'envoi");
    expect(upstream.calls).toHaveLength(0);
    expect(events[0]).toMatchObject({
      outcome: "refused",
      reason: "unanalysed_attachment",
    });
  });

  it("refuses a body over the ceiling with 413", async () => {
    const upstream = fakeUpstream();
    const { baseUrl } = await start({ fetch: upstream.fetch });
    const response = await post(
      `${baseUrl}/v1/messages`,
      "x".repeat(MAX_REQUEST_BYTES + 1),
    );
    expect(response.status).toBe(413);
    expect(upstream.calls).toHaveLength(0);
  });

  it("answers 502 without any direct fallback when Anthropic is unreachable", async () => {
    let attempts = 0;
    const events: RelayEvent[] = [];
    const { baseUrl } = await start({
      fetch: () => {
        attempts += 1;
        return Promise.reject(new Error("offline"));
      },
      onEvent: (event) => events.push(event),
    });
    const response = await post(`${baseUrl}/v1/messages`, PROMPT);
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(CREDENTIAL);
    expect(attempts).toBe(1);
    expect(events[0]).toMatchObject({ outcome: "upstream_unavailable" });
  });

  it("reports its protocol on the health route", async () => {
    const { baseUrl } = await start({ fetch: fakeUpstream().fetch });
    const response = await fetch(`${baseUrl}/health`);
    expect(await response.json()).toEqual({
      protocol: RELAY_PROTOCOL,
      redaction: "required",
    });
  });

  it("serves only its two routes, behind the capability", async () => {
    const upstream = fakeUpstream();
    const { baseUrl } = await start({ fetch: upstream.fetch });
    const origin = new URL(baseUrl).origin;
    expect((await post(`${origin}/v1/messages`, PROMPT)).status).toBe(403);
    expect((await post(`${baseUrl}/v1/complete`, PROMPT)).status).toBe(404);
    expect((await fetch(`${baseUrl}/v1/messages`)).status).toBe(404);
    expect(upstream.calls).toHaveLength(0);
  });

  it("rejects browser and rebinding attempts", async () => {
    const { baseUrl } = await start({ fetch: fakeUpstream().fetch });
    const host = new URL(baseUrl).host;
    expect(await raw(baseUrl, "/health", { host })).toBe(200);
    expect(
      await raw(baseUrl, "/health", { host, origin: "https://evil.example" }),
    ).toBe(403);
    expect(await raw(baseUrl, "/health", { host: "evil.example" })).toBe(403);
  });
});
