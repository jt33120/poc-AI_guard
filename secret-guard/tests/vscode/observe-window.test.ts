import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  closeObserveWindow,
  effectiveMode,
  OBSERVE_WINDOW_MS,
  observeWindowOpen,
  openObserveWindow,
  readObserveDeadline,
} from "../../packages/vscode/src/observe-window.js";

let storage: string;
beforeEach(async () => {
  storage = await mkdtemp(join(tmpdir(), "secret-guard-observe-"));
});
afterEach(async () => {
  await rm(storage, { recursive: true, force: true });
});

describe("Avertir window", () => {
  it("lasts one hour from the moment it opens", async () => {
    const now = 1_800_000_000_000;
    const deadline = await openObserveWindow(storage, now);
    expect(deadline).toBe(now + OBSERVE_WINDOW_MS);
    expect(readObserveDeadline(storage)).toBe(deadline);
    expect(effectiveMode("observe", deadline, now)).toBe("observe");
    expect(effectiveMode("observe", deadline, deadline - 1)).toBe("observe");
    expect(effectiveMode("observe", deadline, deadline)).toBe("redact");
  });

  it("falls back to Expurger without a readable, bounded window", async () => {
    const now = 1_800_000_000_000;
    expect(readObserveDeadline(storage)).toBeUndefined();
    expect(effectiveMode("observe", undefined, now)).toBe("redact");
    // A deadline further than one hour away was not written by Secret Guard.
    expect(observeWindowOpen(now + OBSERVE_WINDOW_MS + 1, now)).toBe(false);
    await writeFile(join(storage, "observe-until"), "tomorrow");
    expect(readObserveDeadline(storage)).toBeUndefined();
  });

  it("leaves the other modes alone", () => {
    expect(effectiveMode("block", undefined, 0)).toBe("block");
    expect(effectiveMode("redact", undefined, 0)).toBe("redact");
  });

  it("closes idempotently", async () => {
    await openObserveWindow(storage, Date.now());
    await closeObserveWindow(storage);
    await closeObserveWindow(storage);
    expect(readObserveDeadline(storage)).toBeUndefined();
  });
});
