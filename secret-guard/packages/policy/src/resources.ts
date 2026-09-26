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
  if (
    roots.length > 0 &&
    !roots.some((root) => {
      const rootFlavor = /^[a-z]:[\\/]/i.test(root) ? path.win32 : path;
      const resolvedRoot = rootFlavor.normalize(rootFlavor.resolve(root));
      const candidate =
        flavor === path.win32 ? normalized.toLowerCase() : normalized;
      const allowed =
        flavor === path.win32 ? resolvedRoot.toLowerCase() : resolvedRoot;
      return (
        candidate.startsWith(`${allowed}${flavor.sep}`) || candidate === allowed
      );
    })
  )
    return { allowed: false, reason: "outside_allowed_roots", normalized };
  return { allowed: true, normalized };
}
