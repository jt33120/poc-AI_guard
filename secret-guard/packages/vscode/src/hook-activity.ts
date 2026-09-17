import {
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import { join } from "node:path";
import process from "node:process";

// A hook process and the extension share the extension's storage folder: the
// hook drops an empty marker while it checks, the extension watches the folder
// to show that a check is running. Markers carry no content, path or verdict.
export const ACTIVITY_FOLDER = "activity";
export const QUIET_ACTIVITY_ENV = "XSOM_SECRET_GUARD_QUIET";

// Past the host's 30 s hook timeout, a marker belongs to a killed process.
const STALE_AFTER_MS = 35_000;
// Checks last about a second end to end, most of it before the hook starts:
// keeping the indicator a little longer avoids a flicker per file.
export const ACTIVITY_LINGER_MS = 1_200;
const RECHECK_MS = 1_000;

export function beginActivity(storage: string): () => void {
  if (process.env[QUIET_ACTIVITY_ENV] === "1") return () => undefined;
  const folder = join(storage, ACTIVITY_FOLDER);
  const marker = join(folder, `${String(process.pid)}.busy`);
  try {
    mkdirSync(folder, { recursive: true });
    writeFileSync(marker, "");
  } catch {
    // The indicator is cosmetic: it never affects the verdict.
    return () => undefined;
  }
  return () => {
    try {
      rmSync(marker, { force: true });
    } catch {
      // Left behind, the marker expires as stale.
    }
  };
}

export function runningChecks(storage: string, now = Date.now()): number {
  const folder = join(storage, ACTIVITY_FOLDER);
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return 0;
  }
  return names.filter((name) => {
    if (!name.endsWith(".busy")) return false;
    try {
      return now - statSync(join(folder, name)).mtimeMs < STALE_AFTER_MS;
    } catch {
      return false;
    }
  }).length;
}

export class ActivityMonitor {
  private readonly watcher: FSWatcher | undefined;
  private readonly recheck: ReturnType<typeof setInterval>;
  private linger: ReturnType<typeof setTimeout> | undefined;
  private busy = false;

  public constructor(
    private readonly storage: string,
    private readonly onChange: (busy: boolean) => void,
  ) {
    let watcher: FSWatcher | undefined;
    try {
      mkdirSync(join(storage, ACTIVITY_FOLDER), { recursive: true });
      watcher = watch(join(storage, ACTIVITY_FOLDER), () => {
        this.update();
      });
      watcher.on("error", () => undefined);
    } catch {
      watcher = undefined;
    }
    this.watcher = watcher;
    // Watch events can be dropped; a slow poll ends a stuck indicator.
    this.recheck = setInterval(() => {
      if (this.busy) this.update();
    }, RECHECK_MS);
  }

  private update(): void {
    if (runningChecks(this.storage) > 0) {
      if (this.linger !== undefined) clearTimeout(this.linger);
      this.linger = undefined;
      this.set(true);
    } else if (this.busy && this.linger === undefined) {
      this.linger = setTimeout(() => {
        this.linger = undefined;
        if (runningChecks(this.storage) === 0) this.set(false);
      }, ACTIVITY_LINGER_MS);
    }
  }

  private set(busy: boolean): void {
    if (busy === this.busy) return;
    this.busy = busy;
    this.onChange(busy);
  }

  public dispose(): void {
    this.watcher?.close();
    clearInterval(this.recheck);
    if (this.linger !== undefined) clearTimeout(this.linger);
  }
}
