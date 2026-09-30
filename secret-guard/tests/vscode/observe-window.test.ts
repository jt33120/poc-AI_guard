import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cappedObserveMinutes,
  closeObserveWindow,
  DEFAULT_OBSERVE_MINUTES,
  effectiveMode,
  isObserveMinutes,
  OBSERVE_DURATIONS,
  OBSERVE_WINDOW_MAX_MS,
  observeCapChange,
  observeCapLine,
  observeDurationLabel,
  observeDurationsWithin,
  observeWindowOpen,
  openObserveWindow,
  readObserveDeadline,
  type ObserveMinutes,
} from "../../packages/vscode/src/observe-window.js";
import { RUNNER_VERSION } from "../../packages/vscode/src/team/runner-version.js";

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
    expect(OBSERVE_WINDOW_MAX_MS).toBe(8 * HOUR);
    expect(observeWindowOpen(now + OBSERVE_WINDOW_MAX_MS, now)).toBe(true);
    expect(observeWindowOpen(now + OBSERVE_WINDOW_MAX_MS + 1, now)).toBe(false);
    await writeFile(join(storage, "observe-until"), "tomorrow");
    expect(readObserveDeadline(storage)).toBeUndefined();
  });

  it("lasts exactly the length chosen in the panel", async () => {
    const now = 1_800_000_000_000;
    expect(OBSERVE_DURATIONS).toEqual([15, 60, 240, 480]);
    for (const minutes of OBSERVE_DURATIONS) {
      const deadline = await openObserveWindow(storage, now, minutes);
      expect(deadline).toBe(now + minutes * 60 * 1000);
      expect(effectiveMode("observe", deadline, deadline - 1)).toBe("observe");
      expect(effectiveMode("observe", deadline, deadline)).toBe("redact");
    }
    expect(
      [15, 60, 240, 480].map((minutes) =>
        observeDurationLabel(minutes as ObserveMinutes),
      ),
    ).toEqual(["15 min", "1 h", "4 h", "8 h"]);
  });

  it("never opens a window longer than the choices allow", async () => {
    const now = 1_800_000_000_000;
    for (const invalid of [0, 30, 720, 1440, -15, 60.5, "60", undefined])
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

describe("Avertir capped by the organization", () => {
  const now = 1_800_000_000_000;
  const MINUTE = 60 * 1000;

  it("offers only the lengths within the cap, none when forbidden", () => {
    expect(observeDurationsWithin(undefined)).toEqual([15, 60, 240, 480]);
    expect(observeDurationsWithin(480)).toEqual([15, 60, 240, 480]);
    expect(observeDurationsWithin(240)).toEqual([15, 60, 240]);
    expect(observeDurationsWithin(60)).toEqual([15, 60]);
    expect(observeDurationsWithin(15)).toEqual([15]);
    expect(observeDurationsWithin(0)).toEqual([]);
  });

  it("shortens the preferred length to the cap, never lengthens it", () => {
    expect(cappedObserveMinutes(480, 60)).toBe(60);
    expect(cappedObserveMinutes(15, 60)).toBe(15);
    expect(cappedObserveMinutes(240, undefined)).toBe(240);
    expect(cappedObserveMinutes(60, 0)).toBeUndefined();
  });

  it("closes a window longer than the cap, and every window at zero", () => {
    expect(observeWindowOpen(now + 60 * MINUTE, now, 60)).toBe(true);
    expect(observeWindowOpen(now + 60 * MINUTE + 1, now, 60)).toBe(false);
    expect(observeWindowOpen(now + 1, now, 0)).toBe(false);
    // A cap above the ceiling does not raise it.
    expect(observeWindowOpen(now + OBSERVE_WINDOW_MAX_MS + 1, now, 480)).toBe(
      false,
    );
    expect(effectiveMode("observe", now + 4 * 60 * MINUTE, now, 60)).toBe(
      "redact",
    );
    expect(effectiveMode("observe", now + 30 * MINUTE, now, 60)).toBe(
      "observe",
    );
    expect(effectiveMode("observe", now + 15 * MINUTE, now, 0)).toBe("redact");
    // Without an organization cap, the 8-hour ceiling alone applies.
    expect(
      effectiveMode("observe", now + 4 * 60 * MINUTE, now, undefined),
    ).toBe("observe");
    expect(effectiveMode("block", undefined, now, 0)).toBe("block");
  });

  it("says what a new cap does to a running window", () => {
    expect(observeCapChange(now + 8 * 60 * MINUTE, now, undefined)).toBe(
      "none",
    );
    expect(observeCapChange(now + 15 * MINUTE, now, 0)).toBe("forbid");
    expect(observeCapChange(now + 4 * 60 * MINUTE, now, 60)).toBe("shorten");
    expect(observeCapChange(now + 60 * MINUTE, now, 60)).toBe("none");
    expect(observeCapChange(undefined, now, 60)).toBe("none");
  });

  it("names the organization as the source of the cap", () => {
    expect(observeCapLine(undefined)).toBeUndefined();
    expect(observeCapLine(60)).toBe("plafonné à 1 h par votre organisation");
    expect(observeCapLine(15)).toBe("plafonné à 15 min par votre organisation");
    expect(observeCapLine(0)).toBe(
      "Avertir est désactivé par votre organisation",
    );
  });

  it("refuses version floors when the runner version was not compiled in", () => {
    // build.mjs defines it for the release; unbuilt, no floor is met.
    expect(RUNNER_VERSION).toBe("0.0.0");
  });
});
