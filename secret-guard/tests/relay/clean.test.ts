import { describe, expect, it } from "vitest";

import {
  cleanRequest,
  createCleaner,
  MAX_REQUEST_BYTES,
  MAX_TEXT_BYTES,
} from "../../packages/relay/src/index";

// Built at runtime so the repository never contains a literal token.
const SECRET = `ghp_${"Ab3".repeat(12)}`;

function body(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function request(content: unknown, extra: Record<string, unknown> = {}) {
  return body({
    model: "claude-test",
    max_tokens: 64,
    messages: [{ role: "user", content }],
    ...extra,
  });
}

function cleaned(input: Buffer, options = {}): string {
  const result = cleanRequest(input, options);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.body.toString("utf8");
}

describe("cleanRequest", () => {
  it("replaces a secret in every inspected place and reports counts only", () => {
    const input = body({
      model: "claude-test",
      system: [{ type: "text", text: `deploy key ${SECRET}` }],
      tools: [{ name: "run", description: `uses ${SECRET}` }],
      messages: [
        { role: "user", content: `my token is ${SECRET}` },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_01SyE8fsUcG9zGc8xQtc6geU",
              name: "Bash",
              input: { command: `curl -H "Authorization: token ${SECRET}"` },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_01SyE8fsUcG9zGc8xQtc6geU",
              content: [{ type: "text", text: `GITHUB_TOKEN=${SECRET}` }],
            },
          ],
        },
      ],
    });
    const result = cleanRequest(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = result.body.toString("utf8");
    expect(text).not.toContain(SECRET);
    expect(text).toContain("<REDACTED_");
    expect(result.redactions).toBeGreaterThanOrEqual(5);
    expect(result.kinds.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.kinds)).not.toContain(SECRET);
    // Model, protocol identifiers and structure are preserved.
    const parsed = JSON.parse(text) as {
      model: string;
      messages: { content: { id?: string; tool_use_id?: string }[] }[];
    };
    expect(parsed.model).toBe("claude-test");
    expect(parsed.messages[1]!.content[0]!.id).toBe(
      "toolu_01SyE8fsUcG9zGc8xQtc6geU",
    );
  });

  it("masks the value of a sensitive field that has no context of its own", () => {
    const text = cleaned(
      request([
        {
          type: "tool_use",
          id: "toolu_01SyE8fsUcG9zGc8xQtc6geU",
          name: "login",
          input: { password: "hunter2", pin_token: 482913, user: "ana" },
        },
      ]),
    );
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("482913");
    expect(text).toContain('"user":"ana"');
    expect(text).toContain("<REDACTED_sensitive_field>");
  });

  it("leaves empty and placeholder values of sensitive fields alone", () => {
    const input = request([
      {
        type: "tool_use",
        id: "toolu_01SyE8fsUcG9zGc8xQtc6geU",
        name: "login",
        input: { password: "", api_key: "<YOUR_API_KEY>" },
      },
    ]);
    const result = cleanRequest(input);
    expect(result.ok && result.redactions).toBe(0);
  });

  it("forwards a clean request byte for byte", () => {
    const input = Buffer.from(
      '{"model":"claude-test",  "messages":[{"role":"user","content":"bonjour"}]}',
    );
    const result = cleanRequest(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.equals(input)).toBe(true);
  });

  it("is deterministic, so the provider's prompt cache keeps working", () => {
    const input = request(`first ${SECRET} then ${SECRET}`);
    expect(cleaned(input)).toBe(cleaned(input));
  });

  it("keeps __proto__ as data instead of a prototype", () => {
    const input = Buffer.from(
      `{"messages":[{"role":"user","content":[{"type":"text","text":"${SECRET}","__proto__":{"polluted":true}}]}]}`,
    );
    const text = cleaned(input);
    expect(text).toContain('"__proto__":{"polluted":true}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("relays signed and encrypted reasoning untouched when it is clean", () => {
    const blocks = [
      { type: "thinking", thinking: "let me check", signature: "sig-abc" },
      { type: "redacted_thinking", data: "EncryptedBlob==" },
      { type: "text", text: SECRET },
    ];
    const parsed = JSON.parse(cleaned(request(blocks))) as {
      messages: { content: unknown[] }[];
    };
    expect(parsed.messages[0]!.content.slice(0, 2)).toEqual(blocks.slice(0, 2));
  });

  describe("refuses instead of forwarding what it cannot clean", () => {
    it.each([
      ["invalid JSON", Buffer.from("{nope"), "invalid_json"],
      ["invalid UTF-8", Buffer.from([0x7b, 0xff, 0x7d]), "invalid_json"],
      ["no messages", body({ model: "x" }), "messages_required"],
      ["messages not a list", body({ messages: "hi" }), "messages_required"],
      [
        "a secret in a protocol identifier",
        request([{ type: "tool_result", tool_use_id: SECRET, content: "ok" }]),
        "secret_in_protocol_identifier",
      ],
      [
        "a secret in signed reasoning",
        request([{ type: "thinking", thinking: SECRET, signature: "s" }]),
        "secret_in_signed_thinking",
      ],
      [
        "unreadable signed reasoning",
        request([{ type: "thinking", thinking: 42, signature: "s" }]),
        "signed_thinking_unreadable",
      ],
      [
        "an image by default",
        request([
          { type: "image", source: { type: "base64", data: "iVBORw0KGgo=" } },
        ]),
        "unanalysed_attachment",
      ],
      [
        "a document by default",
        request([
          { type: "document", source: { type: "base64", data: "JVBERi0=" } },
        ]),
        "unanalysed_attachment",
      ],
    ])("%s", (_name, input, reason) => {
      expect(cleanRequest(input)).toEqual({ ok: false, reason });
    });

    it("a request nested deeper than the walk allows", () => {
      let content: unknown = "leaf";
      for (let depth = 0; depth < 50; depth += 1) content = [content];
      expect(cleanRequest(request(content))).toEqual({
        ok: false,
        reason: "request_too_deep",
      });
    });

    it("a text longer than one scan can cover", () => {
      expect(cleanRequest(request("a ".repeat(600_000)))).toEqual({
        ok: false,
        reason: "scan_incomplete",
      });
    });

    it("a request over the byte ceiling", () => {
      expect(cleanRequest(Buffer.alloc(MAX_REQUEST_BYTES + 1))).toEqual({
        ok: false,
        reason: "request_too_large",
      });
    });

    it("more text in total than the budget", () => {
      const block = "word ".repeat(180_000);
      const count = Math.ceil(MAX_TEXT_BYTES / block.length) + 1;
      const content = Array.from({ length: count }, () => ({
        type: "text",
        text: block,
      }));
      expect(cleanRequest(request(content))).toEqual({
        ok: false,
        reason: "request_too_large",
      });
    });
  });

  it("lets images through, counted, when the user chose to", () => {
    const image = {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
    };
    const result = cleanRequest(
      request([image, { type: "text", text: SECRET }]),
      {
        unanalysed: "allow",
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unanalysed).toBe(1);
    const parsed = JSON.parse(result.body.toString("utf8")) as {
      messages: { content: unknown[] }[];
    };
    expect(parsed.messages[0]!.content[0]).toEqual(image);
  });

  it("reuses its analyses across requests and stays bounded", () => {
    const cleaner = createCleaner({ cacheBytes: 16_384 });
    const turn = (extra: string) =>
      request([
        { type: "text", text: `token ${SECRET}` },
        { type: "text", text: extra },
      ]);
    const first = cleaner.clean(turn("x".repeat(3_000)));
    expect(cleaner.clean(turn("x".repeat(3_000)))).toEqual(first);
    // A text larger than the whole cache is analysed but never kept.
    const large = cleaner.clean(turn("y".repeat(10_000)));
    expect(large.ok && large.redactions).toBe(1);
    // Entries are evicted oldest first; results stay identical afterwards.
    for (const filler of ["a", "b", "c"])
      cleaner.clean(turn(filler.repeat(3_000)));
    expect(cleaner.clean(turn("x".repeat(3_000)))).toEqual(first);
  });
});
