import { describe, expect, it } from "vitest";

import {
  decodeBase64,
  isStructurallyValidJwt,
} from "../../packages/core/src/encoding.js";

describe("bounded Base64 decoding", () => {
  it.each(["A", "@@@=", "A==="])("rejects malformed input: %s", (value) => {
    expect(decodeBase64(value)).toBeNull();
  });

  it("supports standard and URL-safe alphabets with optional padding", () => {
    expect(decodeBase64("aGVsbG8=")).toBe("hello");
    expect(decodeBase64("eyJvayI6dHJ1ZX0")).toBe('{"ok":true}');
  });

  it("rejects decoded output beyond the caller limit", () => {
    expect(decodeBase64("aGVsbG8=", 4)).toBeNull();
  });

  it.each(["/w==", "AA==", "AQIDBA=="])(
    "rejects invalid UTF-8, NUL, or mostly control bytes: %s",
    (value) => {
      expect(decodeBase64(value)).toBeNull();
    },
  );
});

describe("JWT structural validation", () => {
  it("requires exactly three segments and a non-trivial signature", () => {
    expect(isStructurallyValidJwt("one.two")).toBe(false);
    expect(isStructurallyValidJwt("eyJ9.eyJ9.short")).toBe(false);
  });

  it("rejects JSON arrays even when each segment decodes cleanly", () => {
    expect(isStructurallyValidJwt("W10.W10.abcdefgh")).toBe(false);
  });
});
