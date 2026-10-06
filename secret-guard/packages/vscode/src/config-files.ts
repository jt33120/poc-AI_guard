import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";

// Assistant configuration files are shared with the user and other tools:
// they are only ever replaced whole, through a temporary file.

const RENAME_ATTEMPTS = 6;
const LOCK_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

export function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

export function isMissingFile(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

// On Windows a rename fails while another program, often an antivirus scan,
// holds the target open: retry briefly before giving up.
export async function renameReplacing(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = errorCode(error);
      if (
        process.platform !== "win32" ||
        attempt === RENAME_ATTEMPTS ||
        code === undefined ||
        !LOCK_CODES.has(code)
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }
}

export async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export async function writeAtomically(
  path: string,
  content: string | Buffer,
): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await rm(temporary, { force: true });
  await writeFile(temporary, content, { mode: 0o600 });
  try {
    await renameReplacing(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function restoreOptional(
  path: string,
  content: string | Buffer | null,
): Promise<void> {
  if (content === null) await rm(path, { force: true });
  else await writeAtomically(path, content);
}
