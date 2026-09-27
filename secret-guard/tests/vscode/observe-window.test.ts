import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  closeObserveWindow,
  DEFAULT_OBSERVE_MINUTES,
  effectiveMode,
  isObserveMinutes,
  OBSERVE_DURATIONS,
  OBSERVE_WINDOW_MAX_MS,
  observeDurationLabel,
  observeWindowOpen,
  openObserveWindow,
  readObserveDeadline,
  type ObserveMinutes,
} from "../../packages/vscode/src/observe-window.js";

const HOUR = 60 * 60 * 1000;

let storage: string;
beforeEach(async () => {
  storage = await mkdtemp(join(tmpdir(), "secret-guard-observe-"));
});
afterEach(async () => {
  await rm(storage, { recursive: true, force: true });
});

describe("Avertir window", () => {
  it("lasts one hour by default, from the moment it opens", async () => {
    const now = 1_800_000_000_000;
    expect(DEFAULT_OBSERVE_MINUTES).toBe(60);
    const deadline = await openObserveWindow(storage, now);
    expect(deadline).toBe(now + HOUR);
    expect(readObserveDeadline(storage)).toBe(deadline);
    expect(effectiveMode("observe", deadline, now)).toBe("observe");
    expect(effectiveMode("observe", deadline, deadline - 1)).toBe("observe");
    expect(effectiveMode("observe", deadline, deadline)).toBe("redact");
  });

  it("falls back to Expurger without a readable, bounded window", async () => {
    const now = 1_800_000_000_000;
    expect(readObserveDeadline(storage)).toBeUndefined();
    expect(effectiveMode("observe", undefined, now)).toBe("redact");
    // A deadline further than the longest choice was not written by Secret Guard.
    expect(OBSERVE_WINDOW_MAX_MS).toBe(4 * HOUR);
    expect(observeWindowOpen(now + OBSERVE_WINDOW_MAX_MS, now)).toBe(true);
    expect(observeWindowOpen(now + OBSERVE_WINDOW_MAX_MS + 1, now)).toBe(false);
    await writeFile(join(storage, "observe-until"), "tomorrow");
    expect(readObserveDeadline(storage)).toBeUndefined();
  });

  it("lasts exactly the length chosen in the panel", async () => {
    const now = 1_800_000_000_000;
    expect(OBSERVE_DURATIONS).toEqual([15, 60, 240]);
    for (const minutes of OBSERVE_DURATIONS) {
      const deadline = await openObserveWindow(storage, now, minutes);
      expect(deadline).toBe(now + minutes * 60 * 1000);
      expect(effectiveMode("observe", deadline, deadline - 1)).toBe("observe");
      expect(effectiveMode("observe", deadline, deadline)).toBe("redact");
    }
    expect(
      [15, 60, 240].map((minutes) =>
        observeDurationLabel(minutes as ObserveMinutes),
      ),
    ).toEqual(["15 min", "1 h", "4 h"]);
  });

  it("never opens a window longer than the choices allow", async () => {
    const now = 1_800_000_000_000;
    for (const invalid of [0, 30, 480, 1440, -15, 60.5, "60", undefined])
      expect(isObserveMinutes(invalid)).toBe(false);
    const deadline = await openObserveWindow(
      storage,
      now,
      1440 as unknown as ObserveMinutes,
    );
    expect(deadline).toBe(now + HOUR);
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
