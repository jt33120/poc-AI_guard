import type { FindingEncoding, TextPosition, TextSpan } from "./types.js";

export interface MappedView {
  readonly text: string;
  readonly starts: readonly number[] | null;
  readonly ends: readonly number[] | null;
  readonly encoding: FindingEncoding;
}

const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export function identityView(text: string): MappedView {
  return { text, starts: null, ends: null, encoding: "plain" };
}

/** Slice a mapped view while preserving absolute offsets into the original input. */
export function sliceMappedView(
  view: MappedView,
  start: number,
  end: number,
): MappedView {
  const boundedStart = Math.max(0, Math.min(view.text.length, start));
  const boundedEnd = Math.max(boundedStart, Math.min(view.text.length, end));
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = boundedStart; index < boundedEnd; index += 1) {
    starts.push(view.starts?.[index] ?? index);
    ends.push(view.ends?.[index] ?? index + 1);
  }
  return {
    text: view.text.slice(boundedStart, boundedEnd),
    starts,
    ends,
    encoding: view.encoding,
  };
}

function originalBounds(
  view: MappedView,
  start: number,
  end: number,
): [number, number] {
  if (view.starts === null || view.ends === null) return [start, end];
  if (start >= end) {
    const at = view.starts[start] ?? view.ends[start - 1] ?? 0;
    return [at, at];
  }
  return [view.starts[start] ?? 0, view.ends[end - 1] ?? view.text.length];
}

function appendMapped(
  output: string[],
  starts: number[],
  ends: number[],
  value: string,
  originalStart: number,
  originalEnd: number,
): void {
  output.push(value);
  for (let index = 0; index < value.length; index += 1) {
    starts.push(originalStart);
    ends.push(originalEnd);
  }
}

/** NFKC-normalize and remove common zero-width bypass characters while retaining source offsets. */
export function normalizedView(source: string | MappedView): MappedView | null {
  const view = typeof source === "string" ? identityView(source) : source;
  const content = view.text;
  // The common prompt/code path is ASCII. Avoid allocating three million-entry
  // mapping structures when normalization cannot possibly change the input.
  if (!content.includes("\r\n")) {
    let ascii = true;
    for (let index = 0; index < content.length; index += 1) {
      if (content.charCodeAt(index) > 0x7f) {
        ascii = false;
        break;
      }
    }
    if (ascii) return null;
  }

  const output: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];

  for (let offset = 0; offset < content.length;) {
    if (content[offset] === "\r" && content[offset + 1] === "\n") {
      const [start] = originalBounds(view, offset, offset + 1);
      const [, end] = originalBounds(view, offset + 1, offset + 2);
      appendMapped(output, starts, ends, "\n", start, end);
      offset += 2;
      continue;
    }

    const codePoint = content.codePointAt(offset);
    if (codePoint === undefined) break;
    const width = codePoint > 0xffff ? 2 : 1;
    const original = content.slice(offset, offset + width);
    if (!DEFAULT_IGNORABLE.test(original)) {
      const [start, end] = originalBounds(view, offset, offset + width);
      appendMapped(
        output,
        starts,
        ends,
        original.normalize("NFKC"),
        start,
        end,
      );
    }
    offset += width;
  }

  const text = output.join("");
  if (text === content) return null;
  return {
    text,
    starts,
    ends,
    encoding: view.encoding === "plain" ? "normalized" : view.encoding,
  };
}

function isHexPair(value: string): boolean {
  return /^[0-9a-fA-F]{2}$/.test(value);
}

function percentByteAt(text: string, index: number): number | null {
  if (text[index] !== "%") return null;
  const encoded = text.slice(index + 1, index + 3);
  return encoded.length === 2 && isHexPair(encoded)
    ? Number.parseInt(encoded, 16)
    : null;
}

function utf8Width(firstByte: number): number {
  if (firstByte <= 0x7f) return 1;
  if (firstByte >= 0xc2 && firstByte <= 0xdf) return 2;
  if (firstByte >= 0xe0 && firstByte <= 0xef) return 3;
  if (firstByte >= 0xf0 && firstByte <= 0xf4) return 4;
  return 0;
}

function decodePercentCodePoint(
  text: string,
  start: number,
): { readonly end: number; readonly value: string } | null {
  const firstByte = percentByteAt(text, start);
  if (firstByte === null) return null;
  const width = utf8Width(firstByte);
  if (width === 0) return null;

  const bytes = new Uint8Array(width);
  bytes[0] = firstByte;
  for (let offset = 1; offset < width; offset += 1) {
    const byte = percentByteAt(text, start + offset * 3);
    if (byte === null || byte < 0x80 || byte > 0xbf) return null;
    bytes[offset] = byte;
  }

  try {
    return {
      end: start + width * 3,
      value: UTF8_DECODER.decode(bytes),
    };
  } catch {
    // Preserve an invalid escape literally while allowing valid sequences
    // elsewhere in the same input to be decoded independently.
    return null;
  }
}

/** Decode exactly one layer of UTF-8 percent escapes. */
export function percentDecodedView(view: MappedView): MappedView | null {
  if (!/%[0-9a-fA-F]{2}/.test(view.text)) return null;
  const output: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let changed = false;

  for (let index = 0; index < view.text.length;) {
    const decoded = decodePercentCodePoint(view.text, index);
    if (decoded !== null) {
      const [start] = originalBounds(view, index, index + 1);
      const [, end] = originalBounds(view, decoded.end - 1, decoded.end);
      appendMapped(output, starts, ends, decoded.value, start, end);
      index = decoded.end;
      changed = true;
      continue;
    }
    const [start, end] = originalBounds(view, index, index + 1);
    appendMapped(output, starts, ends, view.text[index] ?? "", start, end);
    index += 1;
  }

  if (!changed) return null;
  return { text: output.join(""), starts, ends, encoding: "percent" };
}

/** Decode one layer of JSON Unicode and escaped-slash sequences. */
export function jsonEscapedView(view: MappedView): MappedView | null {
  if (!/\\(?:u[0-9a-fA-F]{4}|\/)/u.test(view.text)) return null;
  const output: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let changed = false;

  for (let index = 0; index < view.text.length; index += 1) {
    const escaped = view.text.slice(index, index + 6);
    if (/^\\u[0-9a-fA-F]{4}$/u.test(escaped)) {
      const [start] = originalBounds(view, index, index + 1);
      const [, end] = originalBounds(view, index + 5, index + 6);
      appendMapped(
        output,
        starts,
        ends,
        String.fromCharCode(Number.parseInt(escaped.slice(2), 16)),
        start,
        end,
      );
      index += 5;
      changed = true;
      continue;
    }
    if (view.text[index] === "\\" && view.text[index + 1] === "/") {
      const [start] = originalBounds(view, index, index + 1);
      const [, end] = originalBounds(view, index + 1, index + 2);
      appendMapped(output, starts, ends, "/", start, end);
      index += 1;
      changed = true;
      continue;
    }
    const [start, end] = originalBounds(view, index, index + 1);
    appendMapped(output, starts, ends, view.text[index] ?? "", start, end);
  }

  return changed
    ? { text: output.join(""), starts, ends, encoding: "json-escaped" }
    : null;
}

/** Join line wraps (plus at most four indentation characters) only for fixed-token detection. */
export function joinedLineView(view: MappedView): MappedView | null {
  if (!/[\r\n]/.test(view.text)) return null;
  const output: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let changed = false;

  for (let index = 0; index < view.text.length; index += 1) {
    if (view.text[index] === "\r" || view.text[index] === "\n") {
      if (view.text[index] === "\r" && view.text[index + 1] === "\n")
        index += 1;
      let indentation = 0;
      while (
        indentation < 4 &&
        (view.text[index + 1] === " " || view.text[index + 1] === "\t")
      ) {
        index += 1;
        indentation += 1;
      }
      changed = true;
      continue;
    }
    const [start, end] = originalBounds(view, index, index + 1);
    appendMapped(output, starts, ends, view.text[index] ?? "", start, end);
  }

  if (!changed) return null;
  return { text: output.join(""), starts, ends, encoding: "whitespace-joined" };
}

export function mapRange(
  view: MappedView,
  start: number,
  end: number,
): [number, number] {
  return originalBounds(view, start, end);
}

function lineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function positionAt(starts: readonly number[], offset: number): TextPosition {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if ((starts[middle] ?? 0) <= offset) low = middle;
    else high = middle;
  }
  return { offset, line: low + 1, column: offset - (starts[low] ?? 0) + 1 };
}

export function makeSpan(
  content: string,
  start: number,
  end: number,
): TextSpan {
  return createSpanFactory(content)(start, end);
}

/** Build line metadata once when mapping many findings in the same input. */
export function createSpanFactory(
  content: string,
): (start: number, end: number) => TextSpan {
  const starts = lineStarts(content);
  return (start: number, end: number): TextSpan => {
    const boundedStart = Math.max(0, Math.min(content.length, start));
    const boundedEnd = Math.max(boundedStart, Math.min(content.length, end));
    return {
      start: positionAt(starts, boundedStart),
      end: positionAt(starts, boundedEnd),
    };
  };
}
