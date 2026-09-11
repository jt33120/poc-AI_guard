import { describe, expect, it } from "vitest";

import {
  MAX_INPUT_BYTES,
  levelForScore,
  redact,
  redactAndRescan,
  scan,
  type Finding,
  type ScanInput,
} from "../../packages/core/src/index";

const GITHUB_TOKEN = `ghp_${"aB3".repeat(12)}`;
const OPENAI_KEY = `sk-proj-${"A1b2".repeat(8)}`;
const GITLAB_TOKEN = `glpat-${"A1b2".repeat(6)}`;
const SLACK_TOKEN = `xoxb-${"A1b2-".repeat(8)}`;

function base64Url(value: string): string {
  return btoa(value).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function jwt(): string {
  return `${base64Url('{"alg":"HS256","typ":"JWT"}')}.${base64Url(
    '{"sub":"123","scope":"read"}',
  )}.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV`;
}

describe("fixed and structural detectors", () => {
  it.each([
    [GITHUB_TOKEN, "github_token"],
    [OPENAI_KEY, "openai_key"],
    [GITLAB_TOKEN, "gitlab_pat"],
    [SLACK_TOKEN, "slack_token"],
    [`AIza${"A1b2".repeat(8)}A1b`, "google_api_key"],
    [`hf_${"A1b2".repeat(9).slice(0, 34)}`, "huggingface_token"],
  ])(
    "blocks a provider credential without relying on entropy: %s",
    (secret, ruleId) => {
      const result = scan({ content: `credential=${secret}` });
      expect(result.decision).toBe("BLOCK");
      expect(result.level).toBe("CRITICAL");
      expect(result.findings.some((finding) => finding.ruleId === ruleId)).toBe(
        true,
      );
    },
  );

  it("requires JWT structure rather than three arbitrary segments", () => {
    const valid = scan({ content: `Authorization: Bearer ${jwt()}` });
    const invalid = scan({
      content: "token abcdefghijkl.abcdefghijkl.abcdefghijkl",
    });

    expect(valid.findings.some((finding) => finding.ruleId === "jwt")).toBe(
      true,
    );
    expect(valid.decision).toBe("BLOCK");
    expect(invalid.findings.some((finding) => finding.ruleId === "jwt")).toBe(
      false,
    );
  });

  it("rejects JWT-shaped input whose decoded JSON is malformed", () => {
    const malformed = scan({
      content: "eyJmb28iOi.eyJzdWIiOiIxIn0.abcdefgh",
    });

    expect(malformed.findings.some((finding) => finding.ruleId === "jwt")).toBe(
      false,
    );
  });

  it("captures and redacts the entire private-key block", () => {
    const pem = [
      "-----BEGIN PRIVATE KEY-----",
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC",
      "AQ8AMIIBCgKCAQEAexampleonly",
      "-----END PRIVATE KEY-----",
    ].join("\r\n");
    const content = `before\n${pem}\nafter`;
    const result = scan({ content });
    const finding = result.findings.find(
      (item) => item.ruleId === "private_key_pem",
    );

    expect(finding).toBeDefined();
    expect(
      content.slice(finding!.span.start.offset, finding!.span.end.offset),
    ).toBe(pem);
    const cleaned = redactAndRescan({ content });
    expect(cleaned.content).not.toContain("MIIEvQIB");
    expect(cleaned.content).not.toContain("BEGIN PRIVATE KEY");
    expect(cleaned.final.decision).toBe("ALLOW");
  });

  it("fails safe on an unterminated private-key block", () => {
    const content =
      "prefix\n-----BEGIN OPENSSH PRIVATE KEY-----\nsecret-body-without-end";
    const result = scan({ content });
    const finding = result.findings.find(
      (item) => item.ruleId === "private_key_pem_incomplete",
    );

    expect(result.decision).toBe("BLOCK");
    expect(finding?.span.end.offset).toBe(content.length);
  });

  it("redacts an oversized unterminated private-key body through EOF", () => {
    const content = `-----BEGIN PRIVATE KEY-----\n${"Ab9+/".repeat(60_000)}\nunchecked-tail`;
    const sanitized = redactAndRescan({ content });

    expect(sanitized.initial.decision).toBe("BLOCK");
    expect(sanitized.content).toBe("<REDACTED_private_key_pem_incomplete>");
    expect(sanitized.final.decision).toBe("ALLOW");
  });

  it("blocks credential-bearing database and generic URLs", () => {
    const database = scan({
      content: "postgresql://alice:tiny@db.internal/app",
    });
    const basic = scan({
      content: "https://robot:s3cr3t@example.test/repository",
    });

    expect(database.findings[0]?.ruleId).toBe("database_url_credentials");
    expect(database.level).toBe("CRITICAL");
    expect(basic.findings[0]?.ruleId).toBe("basic_auth_url");
    expect(basic.decision).toBe("BLOCK");
  });

  it("blocks password-only Redis credential URLs", () => {
    for (const content of [
      "redis://:not-a-real-password@cache.invalid/0",
      "REDIS_URL=redis://:not-a-real-password@cache.invalid/0",
    ]) {
      const result = scan({ content });
      expect(result.decision).toBe("BLOCK");
      expect(result.findings).toContainEqual(
        expect.objectContaining({ ruleId: "database_url_credentials" }),
      );
    }
  });

  it("treats an AWS access-key id alone as a warning, not a secret proof", () => {
    const result = scan({ content: `account id AKIA${"9Z".repeat(8)}` });
    expect(result.decision).toBe("WARN");
    expect(result.level).toBe("MEDIUM");
    expect(result.findings[0]?.score).toBe(45);
  });
});

describe("contextual detector", () => {
  it.each([
    "PASSWORD=x",
    "export DB_PASSWORD='tiny'",
    '"client_secret": "short"',
    "api-key: abc",
    "authorization = bearer-value",
  ])(
    "blocks a sensitive assignment, including a short value: %s",
    (content) => {
      const result = scan({ content, sourceKind: "prompt" });
      expect(result.decision).toBe("BLOCK");
      expect(result.score).toBeGreaterThanOrEqual(50);
      expect(
        result.findings.some((finding) =>
          finding.reasons.includes("sensitive_variable_name"),
        ),
      ).toBe(true);
    },
  );

  it.each([
    "SECRET_KEY=real-value",
    "APP_SECRET=real-value",
    "WEBHOOK_SECRET=real-value",
    '$env:PASSWORD = "real-value"',
    'process.env["API_KEY"] = "real-value"',
    'os.environ["TOKEN"] = "real-value"',
    "tool --password real-value",
    "https://example.test/path?api_key=real-value&view=full",
    "Cookie: token=real-value; theme=dark",
    "SIGNING_KEY=hunter2",
    "ENCRYPTION_KEY=hunter2",
    "//registry.npmjs.org/:_authToken=hunter2",
    '{"auth":"dXNlcjpodW50ZXIy"}',
    "Cookie: sessionid=hunter2; theme=dark",
    "Set-Cookie: sid=hunter2; Path=/; Secure",
    "curl -u admin:hunter2 https://example.test",
    'Deno.env.set("API_KEY", "hunter2")',
  ])("blocks additional V0 credential contexts: %s", (content) => {
    expect(scan({ content }).decision).toBe("BLOCK");
  });

  it("does not treat arbitrary angle-bracketed values as placeholders", () => {
    expect(scan({ content: "PASSWORD=<vraie-valeur>" }).decision).toBe("BLOCK");
  });

  it("does not treat a credential-free database URL as a secret", () => {
    expect(
      scan({ content: "DATABASE_URL=postgresql://localhost/app" }).decision,
    ).toBe("ALLOW");
  });

  it("finds multiple independent secrets and deduplicates an overlapping provider match", () => {
    const content = `PASSWORD=tiny\nAPI_KEY=${GITHUB_TOKEN}\nTOKEN=another-secret`;
    const result = scan({ content });

    expect(result.findings).toHaveLength(3);
    expect(
      result.findings.filter((finding) => finding.ruleId === "github_token"),
    ).toHaveLength(1);
    expect(result.decision).toBe("BLOCK");
  });

  it("redacts a complete unquoted line value rather than leaking trailing words", () => {
    const content = "PASSWORD=correct horse battery staple";
    const sanitized = redactAndRescan({ content });

    expect(sanitized.content).not.toContain("horse");
    expect(sanitized.content).not.toContain("staple");
    expect(sanitized.final.decision).toBe("ALLOW");
  });

  it.each([",tail", ";tail", "}tail", "#tail"])(
    "redacts punctuation that may belong to an unquoted dotenv value: %s",
    (tail) => {
      const content = `PASSWORD=not-a-real-password${tail}`;
      const sanitized = redactAndRescan({ content, languageId: "dotenv" });
      expect(sanitized.content).not.toContain("not-a-real-password");
      expect(sanitized.content).not.toContain("tail");
      expect(sanitized.final.decision).toBe("ALLOW");
    },
  );

  it.each([
    "password: |-\n  not-a-real-password",
    "password: >\n  not-a-real-password\n  second-line",
    "password: |2-\n  not-a-real-password",
    "password: !!str |-\n  not-a-real-password",
    "password: &credential >+2\n  not-a-real-password",
    'password = """not-a-real-password"""',
    'password = r"""not-a-real-password"""',
    "PASSWORD=$(cat <<EOF)\nnot-a-real-password\nEOF",
  ])("redacts a complete multiline credential value: %s", (content) => {
    const sanitized = redactAndRescan({ content });
    expect(sanitized.content).not.toContain("not-a-real-password");
    expect(sanitized.final).toMatchObject({
      complete: true,
      decision: "ALLOW",
      findings: [],
    });
  });

  it.each([
    ['password = r"not-a-real-password"', "python"],
    ['password = b"not-a-real-password"', "python"],
    ['password = f"not-a-real-password"', "python"],
    ['password = @"not-a-real-password"', "csharp"],
    ['password = r#"not-a-real-password"#', "rust"],
  ])(
    "blocks a language-prefixed credential literal: %s",
    (content, languageId) => {
      expect(scan({ content, languageId }).decision).toBe("BLOCK");
    },
  );
});

describe("normalization and bounded transformations", () => {
  it("maps a full-width sensitive key back to the original value span", () => {
    const content = "intro\nＰＡＳＳＷＯＲＤ=hunter2";
    const result = scan({ content });
    const finding = result.findings[0];

    expect(finding?.encoding).toBe("normalized");
    expect(
      content.slice(finding!.span.start.offset, finding!.span.end.offset),
    ).toBe("hunter2");
    expect(finding?.span.start.line).toBe(2);
  });

  it("normalizes CRLF without shifting original offsets", () => {
    const content = `first\r\nＰＡＳＳＷＯＲＤ=hunter2`;
    const finding = scan({ content }).findings[0];

    expect(finding?.span.start.offset).toBe(content.indexOf("hunter2"));
    expect(finding?.span.start.line).toBe(2);
  });

  it("removes zero-width characters for detection without corrupting source offsets", () => {
    const content = `${GITHUB_TOKEN.slice(0, 12)}\u200b${GITHUB_TOKEN.slice(12)}`;
    const result = scan({ content });
    const finding = result.findings.find(
      (item) => item.ruleId === "github_token",
    );

    expect(result.decision).toBe("BLOCK");
    expect(finding?.encoding).toBe("normalized");
    expect(finding?.span.start.offset).toBe(0);
    expect(finding?.span.end.offset).toBe(content.length);
  });

  it.each([
    () => String.raw`ghp_\u200b${"Ab3".repeat(12)}`,
    () => String.raw`\uff47hp_${"Ab3".repeat(12)}`,
    () => `ghp_%0A${"Ab3".repeat(12)}`,
    () => String.raw`g\u0068p_%41${"b3A".repeat(11)}b3`,
    () => String.raw`PASS\u200bWORD=not-a-real-password`,
    () =>
      Buffer.from(`ghp_\u200b${"Ab3".repeat(12)}`, "utf8").toString("base64"),
  ])(
    "canonicalizes bounded composed encodings before approval",
    (makeContent) => {
      const content = makeContent();
      const result = scan({ content });

      expect(result.decision).toBe("BLOCK");
      const sanitized = redactAndRescan({ content });
      expect(sanitized.final.decision).toBe("ALLOW");
      expect(sanitized.content).not.toBe("");
    },
  );

  it("detects a known token split across one line wrap", () => {
    const content = `${GITHUB_TOKEN.slice(0, 18)}\n  ${GITHUB_TOKEN.slice(18)}`;
    const result = scan({ content });
    const finding = result.findings.find(
      (item) => item.ruleId === "github_token",
    );

    expect(result.decision).toBe("BLOCK");
    expect(finding?.encoding).toBe("whitespace-joined");
    expect(finding?.span.end.offset).toBe(content.length);
  });

  it("detects a token even when the provider prefix itself is line-wrapped", () => {
    const content = `g\nhp_${GITHUB_TOKEN.slice(4)}`;
    const finding = scan({ content }).findings.find(
      (item) => item.ruleId === "github_token",
    );

    expect(finding?.encoding).toBe("whitespace-joined");
    expect(finding?.span.start.offset).toBe(0);
    expect(finding?.span.end.offset).toBe(content.length);
  });

  it.each([
    [`sk_live_${"A1b2".repeat(8)}`, "stripe_secret_key"],
    [`AKIA${"A1".repeat(8)}`, "aws_access_key_id"],
    [`AccountKey=${"Ab3+".repeat(16)}=`, "azure_storage_key"],
    [`SG.${"A".repeat(22)}.${"B".repeat(43)}`, "sendgrid_key"],
    [`shpat_${"a1".repeat(16)}`, "shopify_token"],
  ])(
    "detects another fixed credential across a line wrap: %s",
    (secret, ruleId) => {
      const splitAt = Math.floor(secret.length / 2);
      const content = `${secret.slice(0, splitAt)}\n  ${secret.slice(splitAt)}`;
      const result = scan({ content });

      expect(result.decision).not.toBe("ALLOW");
      expect(result.findings).toContainEqual(
        expect.objectContaining({ ruleId, encoding: "whitespace-joined" }),
      );
    },
  );

  it("isolates a line-wrapped token from an unrelated preceding line", () => {
    const content = `A\ngh\np_${GITHUB_TOKEN.slice(4)}`;
    const finding = scan({ content }).findings.find(
      (item) => item.ruleId === "github_token",
    );

    expect(finding?.encoding).toBe("whitespace-joined");
    expect(finding?.span.start.line).toBe(2);
  });

  it("detects one percent-encoding layer and maps the whole encoded span", () => {
    const encoded = [...GITHUB_TOKEN]
      .map(
        (character) =>
          `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`,
      )
      .join("");
    const result = scan({ content: encoded });
    const finding = result.findings.find(
      (item) => item.ruleId === "github_token",
    );

    expect(result.decision).toBe("BLOCK");
    expect(finding?.encoding).toBe("percent");
    expect(finding?.span.start.offset).toBe(0);
    expect(finding?.span.end.offset).toBe(encoded.length);
  });

  it.each([
    `ghp_%E2%80%8B${GITHUB_TOKEN.slice(4)}`,
    `%EF%BD%87%EF%BD%88%EF%BD%90%EF%BC%BF${GITHUB_TOKEN.slice(4)}`,
  ])(
    "decodes UTF-8 percent escapes before Unicode canonicalization: %s",
    (content) => {
      const result = scan({ content });
      const finding = result.findings.find(
        (item) => item.ruleId === "github_token",
      );

      expect(result.decision).toBe("BLOCK");
      expect(finding?.encoding).toBe("percent");
      expect(finding?.span.start.offset).toBe(0);
      expect(finding?.span.end.offset).toBe(content.length);

      const redacted = redactAndRescan({ content });
      expect(redacted.content).not.toContain(GITHUB_TOKEN.slice(4));
      expect(redacted.final).toMatchObject({
        decision: "ALLOW",
        complete: true,
      });
    },
  );

  it("keeps an invalid percent byte literal while decoding a later valid run", () => {
    const encodedToken = [...GITHUB_TOKEN]
      .map(
        (character) =>
          `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`,
      )
      .join("");
    const result = scan({ content: `%FF:${encodedToken}` });

    expect(result.decision).toBe("BLOCK");
    expect(result.findings).toContainEqual(
      expect.objectContaining({ ruleId: "github_token", encoding: "percent" }),
    );
  });

  it("detects one JSON Unicode-escape layer and maps the source span", () => {
    const encoded = [...GITHUB_TOKEN]
      .map(
        (character) =>
          `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
      )
      .join("");
    const finding = scan({ content: encoded }).findings.find(
      (item) => item.ruleId === "github_token",
    );

    expect(finding?.encoding).toBe("json-escaped");
    expect(finding?.span.start.offset).toBe(0);
    expect(finding?.span.end.offset).toBe(encoded.length);
  });

  it("removes bidi formatting controls used to split a known token", () => {
    const content = `${GITHUB_TOKEN.slice(0, 10)}\u202e${GITHUB_TOKEN.slice(10)}`;
    const finding = scan({ content }).findings.find(
      (item) => item.ruleId === "github_token",
    );

    expect(finding?.encoding).toBe("normalized");
    expect(finding?.span.end.offset).toBe(content.length);
  });

  it.each(["\u034f", "\ufe0f", "\u061c", "\u00ad"])(
    "removes a default-ignorable code point used inside a token: %s",
    (control) => {
      const content = `g${control}hp_${GITHUB_TOKEN.slice(4)}`;
      const finding = scan({ content }).findings.find(
        (item) => item.ruleId === "github_token",
      );

      expect(finding?.encoding).toBe("normalized");
      expect(finding?.span.end.offset).toBe(content.length);
    },
  );

  it("detects exactly one Base64 layer", () => {
    const encoded = btoa("PASSWORD=hunter2");
    const once = scan({ content: encoded });
    const twice = scan({ content: btoa(encoded) });

    expect(once.decision).toBe("BLOCK");
    expect(once.findings[0]?.encoding).toBe("base64");
    expect(twice.decision).not.toBe("BLOCK");
  });

  it.each([
    `${"A".repeat(95)}é\nPASSWORD=not-a-real-password`,
    `${"A".repeat(94)}😀\nPASSWORD=not-a-real-password`,
  ])("does not miss Base64 text at a multibyte boundary", (decoded) => {
    const encoded = Buffer.from(decoded, "utf8").toString("base64");
    expect(scan({ content: encoded }).decision).toBe("BLOCK");
  });

  it("detects a Base64 credential split across one line wrap", () => {
    const encoded = btoa("PASSWORD=hunter2");
    const content = `${encoded.slice(0, 12)}\n  ${encoded.slice(12)}`;
    const finding = scan({ content }).findings.find(
      (item) => item.encoding === "base64",
    );

    expect(finding).toBeDefined();
    expect(finding?.span.start.offset).toBe(0);
    expect(finding?.span.end.offset).toBe(content.length);
  });

  it("isolates wrapped Base64 from an unrelated preceding line", () => {
    const encoded = btoa(`TOKEN=${GITHUB_TOKEN}`);
    const content = `A\n${encoded.slice(0, 10)}\n${encoded.slice(10)}`;
    const finding = scan({ content }).findings.find(
      (item) => item.encoding === "base64",
    );

    expect(finding).toBeDefined();
    expect(finding?.span.start.line).toBe(2);
    expect(scan({ content }).decision).toBe("BLOCK");
  });

  it("detects a credential URL with standard JSON slash escaping", () => {
    const content = String.raw`{"url":"https:\/\/alice:hunter2@example.invalid/db"}`;
    const finding = scan({ content }).findings.find(
      (item) => item.ruleId === "basic_auth_url",
    );

    expect(finding?.encoding).toBe("json-escaped");
    expect(scan({ content }).decision).toBe("BLOCK");
  });
});

describe("source locations and risk contract", () => {
  it("uses one-based lines and UTF-16 columns", () => {
    const line = `😀 prefix ${GITHUB_TOKEN}`;
    const content = `first\n${line}`;
    const finding = scan({ content }).findings.find(
      (item) => item.ruleId === "github_token",
    );
    const expectedOffset = content.indexOf(GITHUB_TOKEN);

    expect(finding?.span.start).toEqual({
      offset: expectedOffset,
      line: 2,
      column: line.indexOf(GITHUB_TOKEN) + 1,
    });
  });

  it.each([
    [0, "LOW"],
    [24, "LOW"],
    [25, "MEDIUM"],
    [49, "MEDIUM"],
    [50, "HIGH"],
    [74, "HIGH"],
    [75, "CRITICAL"],
    [100, "CRITICAL"],
  ] as const)("maps score %i to %s", (score, expected) => {
    expect(levelForScore(score)).toBe(expected);
  });

  it("returns ALLOW/LOW for clean text", () => {
    expect(scan({ content: "Explain this pure function." })).toMatchObject({
      decision: "ALLOW",
      level: "LOW",
      score: 0,
      complete: true,
      findings: [],
    });
  });
});

describe("redaction", () => {
  it("redacts original spans from right to left and rescans the exact result", () => {
    const content = `PASSWORD=tiny\nTOKEN=${GITHUB_TOKEN}`;
    const initial = scan({ content });
    const manuallyRedacted = redact(content, initial.findings);
    const sanitized = redactAndRescan({ content });

    expect(manuallyRedacted).toBe(sanitized.content);
    expect(sanitized.content).not.toContain("tiny");
    expect(sanitized.content).not.toContain(GITHUB_TOKEN);
    expect(sanitized.final.decision).toBe("ALLOW");
    expect(content).toContain(GITHUB_TOKEN);
  });

  it("does not turn an incomplete scan into sanitized approval", () => {
    const content = "x".repeat(MAX_INPUT_BYTES + 1);
    const sanitized = redactAndRescan({ content });
    expect(sanitized.content).toBe("");
    expect(sanitized.initial.complete).toBe(false);
    expect(sanitized.final.decision).toBe("BLOCK");
  });

  it("redacts the full contextual value around an embedded fixed token", () => {
    const content = `PASSWORD=outer-secret-${GITHUB_TOKEN}-still-secret`;
    const sanitized = redactAndRescan({ content });

    expect(sanitized.final).toMatchObject({
      complete: true,
      decision: "ALLOW",
      findings: [],
    });
    expect(sanitized.content).not.toContain("outer-secret");
    expect(sanitized.content).not.toContain("still-secret");
    expect(sanitized.content).not.toContain(GITHUB_TOKEN);
  });

  it("unions overlapping and adjacent spans so no covered tail survives", () => {
    const content = "0123456789";
    const finding = (ruleId: string, start: number, end: number): Finding => ({
      ruleId,
      secretType: "generic_secret",
      span: {
        start: { offset: start, line: 1, column: start + 1 },
        end: { offset: end, line: 1, column: end + 1 },
      },
      score: 70,
      level: "HIGH",
      reasons: ["test_overlap"],
      encoding: "plain",
    });
    const redacted = redact(content, [
      finding("left", 2, 6),
      finding("overlap", 4, 8),
      finding("adjacent", 8, 9),
    ]);

    expect(redacted).toBe("01<REDACTED_left>9");
    expect(redacted).not.toContain("2345678");
  });

  it("is idempotent when driven by an authoritative rescan", () => {
    const first = redactAndRescan({ content: `TOKEN=${GITHUB_TOKEN}` });
    const second = redact(first.content, first.final.findings);

    expect(first.final).toMatchObject({
      complete: true,
      decision: "ALLOW",
      findings: [],
    });
    expect(second).toBe(first.content);
  });
});

describe("fail-closed limits", () => {
  it("accepts exactly 1 MiB and blocks 1 MiB plus one byte without scanning a prefix", () => {
    const exact = scan({ content: "a".repeat(MAX_INPUT_BYTES) });
    const over = scan({ content: "a".repeat(MAX_INPUT_BYTES + 1) });

    expect(exact.complete).toBe(true);
    expect(exact.decision).toBe("ALLOW");
    expect(over).toMatchObject({
      decision: "BLOCK",
      level: "CRITICAL",
      complete: false,
    });
    expect(over.findings[0]?.ruleId).toBe("input_too_large");
    expect(over.findings[0]?.span).toEqual({
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 0, line: 1, column: 1 },
    });
  });

  it("measures the limit in UTF-8 bytes", () => {
    const result = scan({ content: "😀".repeat(MAX_INPUT_BYTES / 4 + 1) });
    expect(result.complete).toBe(false);
    expect(result.inputBytes).toBeGreaterThan(MAX_INPUT_BYTES);
  });

  it("fails closed for an invalid runtime argument instead of throwing", () => {
    const result = scan(null as unknown as ScanInput);
    expect(result).toMatchObject({
      decision: "BLOCK",
      complete: false,
      score: 100,
    });
    expect(result.findings[0]?.ruleId).toBe("scanner_failure");
  });

  it("fails closed when Base64 decoding budgets are exhausted", () => {
    const encodedCandidate = btoa("PASSWORD=hunter2");
    const result = scan({
      content: Array.from({ length: 129 }, () => encodedCandidate).join("\n"),
    });

    expect(result).toMatchObject({
      decision: "BLOCK",
      complete: false,
    });
    expect(result.findings[0]?.ruleId).toBe("scanner_failure");
  });

  it("charges rejected Base64 candidates to the global decode budget", () => {
    const invalidCandidate = Buffer.concat([
      Buffer.from("Printable candidate prefix with varied ASCII. ".repeat(3)),
      Buffer.from([0xff, 0xfe]),
    ]).toString("base64");
    const result = scan({
      content: Array.from({ length: 129 }, () => invalidCandidate).join(" "),
    });

    expect(result).toMatchObject({ decision: "BLOCK", complete: false });
    expect(result.findings[0]?.ruleId).toBe("scanner_failure");
  });

  it("does not spend the decode budget on exact SRI digest shapes", () => {
    const sri = `sha512-${"Ab3+".repeat(21)}Ab==`;
    const result = scan({
      content: Array.from({ length: 200 }, () => sri).join("\n"),
    });

    expect(result).toMatchObject({ decision: "ALLOW", complete: true });
  });

  it("shares the decode budget across JWT and Docker auth operations", () => {
    const encodedAuth = btoa("user:not-a-real-password");
    const content = [
      ...Array.from({ length: 32 }, () => jwt()),
      ...Array.from({ length: 65 }, () => `{"auth":"${encodedAuth}"}`),
    ].join("\n");
    const result = scan({ content });

    expect(result).toMatchObject({ decision: "BLOCK", complete: false });
    expect(result.findings[0]?.ruleId).toBe("scanner_failure");
  });

  it("never performs a nested Base64 decode through Docker auth", () => {
    const inner = btoa("user:not-a-real-password");
    const outer = btoa(`{"auth":"${inner}"}`);
    expect(scan({ content: outer }).decision).not.toBe("BLOCK");
  });

  it("shares one global budget across fixed and Base64 line-wrap windows", () => {
    const fixed = `g\nhp_${"aB3".repeat(12)}`;
    const encoded = btoa("PASSWORD=hunter2");
    const wrappedBase64 = `${encoded.slice(0, 12)}\n${encoded.slice(12)}`;
    const content = [
      ...Array.from({ length: 64 }, () => fixed),
      ...Array.from({ length: 65 }, () => wrappedBase64),
    ].join("\n!");
    const result = scan({ content });

    expect(result).toMatchObject({ decision: "BLOCK", complete: false });
    expect(result.findings[0]?.ruleId).toBe("scanner_failure");
  });

  it("fails closed when split JWT validation exhausts the decode budget", () => {
    const invalidSplitJwt = "e\nyJaaaa.eyJbbbb.cccccccc";
    const validJwt = jwt();
    const validSplitJwt = `e\nyJ${validJwt.slice(3)}`;
    const content = [
      ...Array.from({ length: 64 }, () => invalidSplitJwt),
      validSplitJwt,
    ].join("\n!");
    const result = scan({ content });

    expect(result).toMatchObject({ decision: "BLOCK", complete: false });
    expect(result.findings[0]?.ruleId).toBe("scanner_failure");
  });

  it("fails closed instead of returning a partial verdict past the finding cap", () => {
    const result = scan({
      content: Array.from({ length: 2_049 }, () => "TOKEN=x").join("\n"),
    });

    expect(result).toMatchObject({ decision: "BLOCK", complete: false });
  });
});
