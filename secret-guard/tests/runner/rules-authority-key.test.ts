import { spawnSync } from "node:child_process";
import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  authorityKeyId,
  readAuthorityKeys,
  TEST_AUTHORITY_PUBLIC_KEYS,
} from "../../scripts/rules-authority.mjs";

const script = resolve("scripts/generate-rules-authority-key.mjs");

function run(...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

function seedKey(seed: string): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(seed, "base64"),
    ]),
    format: "der",
    type: "pkcs8",
  });
}

describe("rules authority key ceremony", () => {
  it("writes the seed 0600 outside the repository and prints only public values", async () => {
    directory = await mkdtemp(join(tmpdir(), "rules-authority-"));
    const out = join(directory, "nested", "authority.seed");
    const result = run("--out", out);
    expect(result.status, result.stderr).toBe(0);
    if (process.platform !== "win32")
      expect((await stat(out)).mode & 0o777).toBe(0o600);
    const seed = (await readFile(out, "utf8")).trim();
    expect(Buffer.from(seed, "base64")).toHaveLength(32);
    expect(result.stdout).not.toContain(seed);
    const publicKey = /Public key: (\S+)/u.exec(result.stdout)?.[1];
    const keyId = /keyId: +(\S+)/u.exec(result.stdout)?.[1];
    expect(publicKey).toBeDefined();
    expect(keyId).toBe(authorityKeyId(publicKey!));
    expect(result.stdout).toContain("XSOM_RULES_SIGNING_KEY");
    expect(result.stdout).toContain("XSOM_RULES_AUTHORITY_KEYS");
    // The seed signs what the printed public key verifies.
    const message = Buffer.from("pack");
    const jwk = createPublicKey(seedKey(seed)).export({ format: "jwk" }) as {
      x: string;
    };
    expect(Buffer.from(jwk.x, "base64url").toString("base64")).toBe(publicKey);
    expect(
      verify(
        null,
        message,
        createPublicKey(seedKey(seed)),
        sign(null, message, seedKey(seed)),
      ),
    ).toBe(true);
    // Never overwrites an existing seed.
    expect(run("--out", out).status).toBe(1);
    expect((await readFile(out, "utf8")).trim()).toBe(seed);
  });

  it("refuses to write the seed inside the repository", () => {
    const result = run("--out", resolve("contracts/authority.seed"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("inside the repository");
  });

  it("validates build keys and keeps the test key out of real builds", () => {
    const [testKey] = TEST_AUTHORITY_PUBLIC_KEYS;
    expect(() =>
      readAuthorityKeys({ XSOM_RULES_AUTHORITY_KEYS: testKey }),
    ).toThrow(/TEST key/u);
    expect(
      readAuthorityKeys({
        XSOM_RULES_AUTHORITY_KEYS: testKey,
        XSOM_RULES_TEST_BUILD: "1",
      }),
    ).toEqual([testKey]);
    expect(() =>
      readAuthorityKeys({ XSOM_RULES_AUTHORITY_KEYS: "abc" }),
    ).toThrow(/32 bytes/u);
    const other = Buffer.alloc(32, 9).toString("base64");
    expect(() =>
      readAuthorityKeys({ XSOM_RULES_AUTHORITY_KEYS: `${other},${other}` }),
    ).toThrow(/twice/u);
    expect(readAuthorityKeys({})).toEqual([]);
  });
});
