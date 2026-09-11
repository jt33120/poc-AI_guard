import { describe, expect, it } from "vitest";

import {
  MAX_INPUT_BYTES,
  redactAndRescan,
  scan,
} from "../../packages/core/src/index";

const SECRET = `ghp_${"Ab3".repeat(12)}`;
const QUOTED_ENV_REFERENCE = ['PASSWORD="process', "env", 'PASSWORD"'].join(
  ".",
);
const STRIPE_PUBLIC_EXAMPLE = ["sk", "test", "4eC39HqLyjWDarjtT1zdp7dc"].join(
  "_",
);

describe("false-positive controls", () => {
  it.each([
    "550e8400-e29b-41d4-a716-446655440000",
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    `sha512-${"Ab9+/".repeat(22)}==`,
    "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    `pk_live_${"Ab3".repeat(16)}`,
  ])("does not warn on a known safe identifier shape: %s", (content) => {
    expect(scan({ content }).decision).toBe("ALLOW");
  });

  it("does not treat the canonical Base64 alphabet as entropy", () => {
    expect(
      scan({
        content:
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
      }).decision,
    ).toBe("ALLOW");
  });

  it.each([
    "PASSWORD=${PASSWORD}",
    "API_KEY=<YOUR_API_KEY>",
    "TOKEN=REPLACE_ME",
    "CLIENT_SECRET=********",
    "SECRET={{ vault.secret }}",
  ])("suppresses only an exact placeholder value: %s", (content) => {
    expect(scan({ content }).decision).toBe("ALLOW");
  });

  it("does not exempt a shell placeholder carrying a literal fallback", () => {
    expect(
      scan({ content: "PASSWORD=${UNSET:-not-a-real-password}" }).decision,
    ).toBe("BLOCK");
  });

  it.each([
    "/docs/secret-guard/THREAT_MODEL",
    "node_modules/github-from-package",
    "node_modules/lightningcss-win32-arm64-msvc",
  ])("does not warn on a path-shaped identifier: %s", (content) => {
    expect(scan({ content }).decision).toBe("ALLOW");
  });

  it.each([
    "password: null",
    "password: false",
    "password: undefined",
    "apiKey: process.env.API_KEY",
    "api_key = var.api_key",
    "csrfToken: null",
    "tokenizer: bert-base-uncased",
    'jsonwebtoken: "^9.0.2"',
    'js-tokens: "^9.0.0"',
    "password: string;",
    "password: z.string().min(8)",
    "confirmPassword: form.password",
    "token: vscode.CancellationToken",
  ])("allows an explicit non-secret scalar or reference: %s", (content) => {
    expect(scan({ content }).decision).toBe("ALLOW");
  });

  it.each([
    "const password: string = form.password;",
    "const { password: userPassword } = form;",
    "const options = { token: tokenValue };",
    "accessToken: await vault.get()",
    "password: string | null",
    "return password === input.password",
    "password: condition ? first : second",
    "password: new SecretValue()",
    "type Input = { password: String! };",
    'const schema = {"password":{"type":"string"}};',
    'enum Field { AccessToken = "access_token" }',
    "const value = { token: tokenValue };",
    "const PASSWORD = parsed.password;",
    "const API_KEY = Deno.env.get('API_KEY');",
    'const API_KEY = process.env.API_KEY ?? "";',
    "const TOKEN = /[A-Za-z0-9_-]{20,512}/g;",
  ])("allows a non-literal TypeScript credential expression: %s", (content) => {
    expect(scan({ content, languageId: "typescript" }).decision).toBe("ALLOW");
  });

  it.each([
    "PASSWORD=${{ secrets.PASSWORD }}",
    "Cookie: sessionid=<redacted>; theme=dark",
  ])("allows an explicit protected placeholder: %s", (content) => {
    expect(scan({ content }).decision).toBe("ALLOW");
  });

  it("still blocks a quoted or numeric credential literal in code", () => {
    expect(
      scan({ content: 'const password = "hunter2";', languageId: "typescript" })
        .decision,
    ).toBe("BLOCK");
    expect(
      scan({ content: "const password = 1234;", languageId: "typescript" })
        .decision,
    ).toBe("BLOCK");
  });

  it.each([
    "PASSWORD=myrealpassword",
    "PASSWORD=supersecret",
    "TOKEN=mysecrettoken",
    "API_KEY=myApiKey",
    "PASSWORD=c2VjcmV0==",
    "TOKEN=QUJDREVGR0hJSktMTU5PUA==",
    "PASSWORD=new password",
    "PASSWORD=abc==def",
  ])("never mistakes a dotenv literal for a code expression: %s", (content) => {
    expect(scan({ content, languageId: "dotenv" }).decision).toBe("BLOCK");
    expect(scan({ content }).decision).toBe("BLOCK");
  });

  it("infers an untyped const reference as code without weakening bare dotenv", () => {
    expect(
      scan({ content: "const password = process.env.PASSWORD;" }).decision,
    ).toBe("ALLOW");
    expect(scan({ content: "PASSWORD=process.env.PASSWORD" }).decision).toBe(
      "BLOCK",
    );
  });

  it("allows a JSON Schema type descriptor but blocks a JSON secret object", () => {
    expect(
      scan({
        content: '{"properties":{"password":{"type":"string"}}}',
        languageId: "json",
      }).decision,
    ).toBe("ALLOW");
    expect(
      scan({
        content: '{"password":{"value":"not-a-real-password"}}',
        languageId: "json",
      }).decision,
    ).toBe("BLOCK");
  });

  it("treats a Rust raw byte string assigned to a password as a literal", () => {
    expect(
      scan({
        content: 'let password = br#"not-a-real-password"#;',
        languageId: "rust",
      }).decision,
    ).toBe("BLOCK");
  });

  it.each([
    ['password := "not-a-real-password"', "go"],
    ["password := `not-a-real-password`", "go"],
    ['const char* password = u8"not-a-real-password";', "cpp"],
    ['const wchar_t* password = L"not-a-real-password";', "cpp"],
    ["const password = String.raw`not-a-real-password`;", "javascript"],
    ["password = %q(not-a-real-password)", "ruby"],
    ['const password = "example" + "not-a-real-password";', "javascript"],
  ])(
    "blocks a language literal instead of exempting its expression: %s",
    (content, languageId) => {
      expect(scan({ content, languageId }).decision).toBe("BLOCK");
    },
  );

  it.each([
    'String password = System.getenv("PASSWORD");',
    'var password = Environment.GetEnvironmentVariable("PASSWORD");',
    'password := os.Getenv("PASSWORD")',
    'let password = std::env::var("PASSWORD")',
    'let password = std::env::var("PASSWORD")?;',
    "password: string | null",
    'password="$(pass show service/password)"',
  ])("allows an untyped, non-literal code reference: %s", (content) => {
    expect(scan({ content }).decision).toBe("ALLOW");
  });

  it("does not let a safe placeholder hide a concatenated literal", () => {
    expect(scan({ content: "PASSWORD=${PASSWORD}suffix" }).decision).toBe(
      "BLOCK",
    );
  });

  it.each([
    "PASSWORD=null",
    "PASSWORD=true",
    "PASSWORD=string",
    "PASSWORD=process.env.PASSWORD",
    "PASSWORD=config.password",
    "PASSWORD=getSecret()",
    'PASSWORD="null"',
    'PASSWORD="string"',
    QUOTED_ENV_REFERENCE,
  ])("treats dotenv reference-shaped text as a literal: %s", (content) => {
    expect(scan({ content, languageId: "dotenv" }).decision).toBe("BLOCK");
    expect(scan({ content }).decision).toBe("BLOCK");
  });

  it("suppresses exact published examples without trusting a file/test context", () => {
    expect(
      scan({ content: "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE" }).decision,
    ).toBe("ALLOW");
    expect(scan({ content: STRIPE_PUBLIC_EXAMPLE }).decision).toBe("ALLOW");
    expect(
      scan({
        content: "PASSWORD=dummy",
        sourceKind: "document",
        languageId: "dotenv",
      }).decision,
    ).toBe("BLOCK");
  });

  it("does not block a percent-encoded placeholder in URL credentials", () => {
    expect(
      scan({ content: "postgres://user:%24%7BDB_PASSWORD%7D@localhost/app" })
        .decision,
    ).toBe("ALLOW");
  });

  it("keeps unanchored high entropy at WARN", () => {
    const result = scan({ content: "opaque Zx9Qw3Vb7Kp2Lm8Nr4Ts6Uy1Wd5Ef0Gh" });
    expect(result).toMatchObject({
      decision: "WARN",
      level: "MEDIUM",
      score: 35,
    });
    expect(result.findings[0]?.ruleId).toBe("high_entropy");
  });
});

describe("non-disclosure", () => {
  it("serializes no raw or partially masked secret", () => {
    const result = scan({ content: `send ${SECRET}` });
    const serialized = JSON.stringify(result);
    const findingKeys = Object.keys(result.findings[0] ?? {}).sort();

    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(SECRET.slice(0, 12));
    expect(serialized).not.toContain(SECRET.slice(-12));
    expect(findingKeys).toEqual(
      [
        "encoding",
        "level",
        "reasons",
        "ruleId",
        "score",
        "secretType",
        "span",
      ].sort(),
    );
  });

  it("keeps all reasons constant and independent of user-controlled text", () => {
    const marker = "USER_CONTROLLED_MARKER";
    const result = scan({ content: `PASSWORD=${marker}` });
    expect(JSON.stringify(result.findings[0]?.reasons)).not.toContain(marker);
  });

  it("redacts an encoded source span and leaves no blocking transformed view", () => {
    const encoded = btoa(`TOKEN=${SECRET}`);
    const result = redactAndRescan({ content: encoded });
    expect(result.content).not.toBe(encoded);
    expect(result.final.decision).toBe("ALLOW");
  });

  it("returns no candidate content when the runtime input is invalid", () => {
    const result = redactAndRescan(null as never);
    expect(result.content).toBe("");
    expect(result.final).toMatchObject({ decision: "BLOCK", complete: false });
  });
});

describe("adversarial bounded behavior", () => {
  it("does not catastrophically backtrack on a 1 MiB non-match", () => {
    const content = `${"sk-".repeat(100_000)}${"'=".repeat(100_000)}`.slice(
      0,
      MAX_INPUT_BYTES,
    );
    const started = performance.now();
    const result = scan({ content });
    const elapsed = performance.now() - started;

    expect(result.complete).toBe(true);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("scans a 1 MiB Base64-alphabet line in linear time", () => {
    const content = "a".repeat(MAX_INPUT_BYTES);
    const started = performance.now();
    const result = scan({ content });
    const elapsed = performance.now() - started;

    expect(result.complete).toBe(true);
    expect(result.decision).toBe("ALLOW");
    expect(elapsed).toBeLessThan(2_000);
  });

  it("handles dense unterminated PEM headers in bounded time", () => {
    const fragment = `-----BEGIN PRIVATE KEY-----\n${"A".repeat(1_000)}\n`;
    const content = fragment.repeat(900).slice(0, MAX_INPUT_BYTES);
    const started = performance.now();
    const result = scan({ content });
    const elapsed = performance.now() - started;

    expect(result.decision).toBe("BLOCK");
    expect(elapsed).toBeLessThan(2_000);
  });

  it("handles dense overlapping candidates deterministically", () => {
    const content = Array.from(
      { length: 200 },
      (_, index) => `TOKEN=value-${index}-Ab9Xy7`,
    ).join("\n");
    const first = scan({ content });
    const second = scan({ content });

    expect(first).toEqual(second);
    expect(first.decision).toBe("BLOCK");
    expect(first.findings.length).toBe(200);
  });

  it("does not recursively decode nested Base64", () => {
    const once = btoa(`PASSWORD=${SECRET}`);
    const twice = btoa(once);
    const result = scan({ content: twice });

    expect(
      result.findings.every((finding) => finding.encoding !== "base64"),
    ).toBe(true);
    expect(result.decision).not.toBe("BLOCK");
  });
});
