import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { afterEach, describe, expect, it } from "vitest";

import {
  ACTIVITY_FOLDER,
  ActivityMonitor,
  beginActivity,
  QUIET_ACTIVITY_ENV,
  runningChecks,
} from "../../packages/vscode/src/hook-activity.js";

const folders: string[] = [];
const monitors: ActivityMonitor[] = [];

afterEach(() => {
  for (const monitor of monitors.splice(0)) monitor.dispose();
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
  Reflect.deleteProperty(process.env, QUIET_ACTIVITY_ENV);
});

function storage(): string {
  const folder = mkdtempSync(join(tmpdir(), "secret-guard-activity-"));
  folders.push(folder);
  return folder;
}

async function until(condition: () => boolean, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("hook activity markers", () => {
  it("marks a running check and clears it when done", () => {
    const folder = storage();
    const done = beginActivity(folder);
    expect(runningChecks(folder)).toBe(1);
    done();
    expect(runningChecks(folder)).toBe(0);
  });

  it("stays silent for health canaries and unwritable storage", () => {
    const folder = storage();
    process.env[QUIET_ACTIVITY_ENV] = "1";
    beginActivity(folder);
    expect(runningChecks(folder)).toBe(0);
    Reflect.deleteProperty(process.env, QUIET_ACTIVITY_ENV);
    const blocker = join(folder, "not-a-folder");
    writeFileSync(blocker, "");
    expect(() => {
      beginActivity(blocker)();
    }).not.toThrow();
  });

  it("ignores markers left by a killed hook", () => {
    const folder = storage();
    beginActivity(folder);
    const marker = join(folder, ACTIVITY_FOLDER, `${String(process.pid)}.busy`);
    const old = new Date(Date.now() - 60_000);
    utimesSync(marker, old, old);
    expect(runningChecks(folder)).toBe(0);
  });

  it("reports busy while a check runs, then idle after a short linger", async () => {
    const folder = storage();
    const states: boolean[] = [];
    monitors.push(new ActivityMonitor(folder, (busy) => states.push(busy)));
    const done = beginActivity(folder);
    await until(() => states.at(-1) === true);
    const endedAt = Date.now();
    done();
    await until(() => states.at(-1) === false);
    expect(Date.now() - endedAt).toBeGreaterThanOrEqual(1_000);
    expect(states).toEqual([true, false]);
  }, 10_000);
});
