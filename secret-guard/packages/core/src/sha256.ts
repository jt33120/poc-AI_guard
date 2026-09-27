// SHA-256 (FIPS 180-4) in plain TypeScript. The core must stay synchronous and
// free of runtime dependencies (no `node:crypto`, no Web Crypto promise), yet
// the xSOM terms detectors compare salted SHA-256 digests on every scan.

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
] as const;

const HEX = Array.from({ length: 256 }, (_, value) =>
  value.toString(16).padStart(2, "0"),
);

/** Reusable hashing state: one instance hashes many short messages without allocating. */
export class Sha256 {
  private readonly words = new Int32Array(64);
  private readonly state = new Uint32Array(8);
  private readonly block = new Uint8Array(128);

  /** Hash `length` bytes of `message`; the returned view is overwritten by the next call. */
  public digest(message: Uint8Array, length = message.length): Uint32Array {
    const state = this.state;
    state.set(INITIAL);
    let offset = 0;
    while (length - offset >= 64) {
      this.compress(message, offset);
      offset += 64;
    }
    const rest = length - offset;
    const paddedLength = rest < 56 ? 64 : 128;
    const block = this.block;
    // Byte loops, not subarray()/set(): no view allocated per hash.
    for (let index = 0; index < rest; index += 1)
      block[index] = message[offset + index] as number;
    block[rest] = 0x80;
    for (let index = rest + 1; index < paddedLength - 8; index += 1)
      block[index] = 0;
    const bits = length * 8;
    // Messages here stay far below 2^32 bits; the high word is still written.
    const high = Math.floor(bits / 0x100000000);
    block[paddedLength - 8] = high >>> 24;
    block[paddedLength - 7] = (high >>> 16) & 0xff;
    block[paddedLength - 6] = (high >>> 8) & 0xff;
    block[paddedLength - 5] = high & 0xff;
    block[paddedLength - 4] = (bits >>> 24) & 0xff;
    block[paddedLength - 3] = (bits >>> 16) & 0xff;
    block[paddedLength - 2] = (bits >>> 8) & 0xff;
    block[paddedLength - 1] = bits & 0xff;
    this.compress(block, 0);
    if (paddedLength === 128) this.compress(block, 64);
    return state;
  }

  /** Number of 64-byte compressions needed for a message of `length` bytes. */
  public static blocks(length: number): number {
    return Math.floor((length + 8) / 64) + 1;
  }

  private compress(bytes: Uint8Array, offset: number): void {
    // Int32 arithmetic (`| 0`) keeps V8 on its small-integer fast path; the
    // state is read back as unsigned by the Uint32Array.
    const w = this.words;
    for (let index = 0; index < 16; index += 1) {
      const at = offset + index * 4;
      w[index] =
        ((bytes[at] as number) << 24) |
        ((bytes[at + 1] as number) << 16) |
        ((bytes[at + 2] as number) << 8) |
        (bytes[at + 3] as number);
    }
    for (let index = 16; index < 64; index += 1) {
      const x = w[index - 15] as number;
      const y = w[index - 2] as number;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 =
        ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[index] =
        ((w[index - 16] as number) + s0 + (w[index - 7] as number) + s1) | 0;
    }
    const state = this.state;
    let a = (state[0] as number) | 0;
    let b = (state[1] as number) | 0;
    let c = (state[2] as number) | 0;
    let d = (state[3] as number) | 0;
    let e = (state[4] as number) | 0;
    let f = (state[5] as number) | 0;
    let g = (state[6] as number) | 0;
    let h = (state[7] as number) | 0;
    for (let index = 0; index < 64; index += 1) {
      const s1 =
        ((e >>> 6) | (e << 26)) ^
        ((e >>> 11) | (e << 21)) ^
        ((e >>> 25) | (e << 7));
      const choice = (e & f) ^ (~e & g);
      const t1 =
        (h + s1 + choice + (K[index] as number) + (w[index] as number)) | 0;
      const s0 =
        ((a >>> 2) | (a << 30)) ^
        ((a >>> 13) | (a << 19)) ^
        ((a >>> 22) | (a << 10));
      const majority = (a & b) ^ (a & c) ^ (b & c);
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + s0 + majority) | 0;
    }
    state[0] = (state[0] as number) + a;
    state[1] = (state[1] as number) + b;
    state[2] = (state[2] as number) + c;
    state[3] = (state[3] as number) + d;
    state[4] = (state[4] as number) + e;
    state[5] = (state[5] as number) + f;
    state[6] = (state[6] as number) + g;
    state[7] = (state[7] as number) + h;
  }
}

export function digestHex(words: Uint32Array): string {
  let hex = "";
  for (let index = 0; index < 8; index += 1) {
    const word = words[index] ?? 0;
    hex +=
      (HEX[word >>> 24] ?? "") +
      (HEX[(word >>> 16) & 0xff] ?? "") +
      (HEX[(word >>> 8) & 0xff] ?? "") +
      (HEX[word & 0xff] ?? "");
  }
  return hex;
}

/** Hexadecimal SHA-256 of a byte string. */
export function sha256Hex(message: Uint8Array): string {
  return digestHex(new Sha256().digest(message));
}
