import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@xsom/secret-guard-core";
import { Sha256 } from "../../packages/core/src/sha256.js";

const encoder = new TextEncoder();

describe("TypeScript SHA-256", () => {
  it("matches the FIPS 180-4 examples", () => {
    expect(sha256Hex(encoder.encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(
      sha256Hex(
        encoder.encode(
          "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
        ),
      ),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("agrees with node:crypto on every padding boundary and random inputs", () => {
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed >>> 24;
    };
    const lengths = [
      ...Array.from({ length: 200 }, (_, index) => index),
      511,
      512,
      1000,
      4096,
    ];
    for (const length of lengths) {
      const message = Uint8Array.from({ length }, next);
      expect(sha256Hex(message), `length ${length}`).toBe(
        createHash("sha256").update(message).digest("hex"),
      );
    }
  });

  it("reuses one state for many messages and honours an explicit length", () => {
    const sha = new Sha256();
    const buffer = encoder.encode("abcXXXXXXXX");
    sha.digest(encoder.encode("warm up with another message"));
    expect(
      Buffer.from(sha.digest(buffer, 3).slice().buffer)
        .swap32()
        .toString("hex"),
    ).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(Sha256.blocks(55)).toBe(1);
    expect(Sha256.blocks(56)).toBe(2);
  });
});
