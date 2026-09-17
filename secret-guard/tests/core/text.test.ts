import { describe, expect, it } from "vitest";

import { decodeScannableText } from "../../packages/core/src/text.js";
import { MAX_INPUT_BYTES } from "../../packages/core/src/types.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("scannable text decoding", () => {
  it("returns UTF-8 text unchanged", () => {
    expect(decodeScannableText(bytes("# Notes\nclé = é"))).toBe(
      "# Notes\nclé = é",
    );
  });

  it("rejects binary content, invalid UTF-8 and oversized input", () => {
    expect(decodeScannableText(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0))).toBe(
      undefined,
    );
    expect(decodeScannableText(Uint8Array.of(0xff, 0xfe, 0x41))).toBe(
      undefined,
    );
    expect(
      decodeScannableText(new Uint8Array(MAX_INPUT_BYTES + 1).fill(0x61)),
    ).toBe(undefined);
    expect(
      decodeScannableText(new Uint8Array(MAX_INPUT_BYTES).fill(0x61))?.length,
    ).toBe(MAX_INPUT_BYTES);
  });
});
