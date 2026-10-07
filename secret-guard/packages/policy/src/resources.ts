import path from "node:path";

const SENSITIVE_NAMES = new Set([
  ".env",
  ".env.local",
  "credentials",
  "credentials.json",
  "id_rsa",
  "id_ed25519",
]);

export interface ResourceDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly normalized: string;
}

/**
 * Lexical form of a filesystem path used for every comparison in this package:
 * `.`/`..` resolved, separators unified, drive-letter (Windows) paths
 * lower-cased. Relative paths resolve against the process working directory.
 * Pure string work: symbolic links are NOT followed; resolving them (realpath)
 * is the caller's job before handing the path to the policy.
 */
export interface NormalizedPath {
  readonly flavor: typeof path.posix | typeof path.win32;
  readonly value: string;
}

export function normalizePath(raw: string): NormalizedPath {
  const flavor = /^[a-z]:[\\/]/i.test(raw) ? path.win32 : path;
  const resolved = flavor.normalize(flavor.resolve(raw));
  return {
    flavor,
    value: flavor === path.win32 ? resolved.toLowerCase() : resolved,
  };
}

/** True when `candidate` is `root` itself or lies below it, on a segment boundary. */
export function isWithin(
  candidate: NormalizedPath,
  root: NormalizedPath,
): boolean {
  if (candidate.flavor !== root.flavor) return false;
  if (candidate.value === root.value) return true;
  const base = root.value.endsWith(root.flavor.sep)
    ? root.value
    : `${root.value}${root.flavor.sep}`;
  return candidate.value.startsWith(base);
}

export function evaluateResource(
  resource: string,
  roots: readonly string[] = [],
): ResourceDecision {
  const flavor = /^[a-z]:[\\/]/i.test(resource) ? path.win32 : path;
  const normalized = flavor.normalize(flavor.resolve(resource));
  const pieces = normalized.split(flavor.sep);
  if (
    pieces.some((part) => SENSITIVE_NAMES.has(part.toLowerCase())) ||
    /\.(pem|key|p12|pfx)$/i.test(normalized)
  )
    return { allowed: false, reason: "sensitive_resource", normalized };
  const candidate = normalizePath(resource);
  if (
    roots.length > 0 &&
    !roots.some((root) => isWithin(candidate, normalizePath(root)))
  )
    return { allowed: false, reason: "outside_allowed_roots", normalized };
  return { allowed: true, normalized };
}
