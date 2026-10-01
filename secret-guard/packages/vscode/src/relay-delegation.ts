import type { LiveRelay } from "./gateway-delegation.js";

/** What the hook saw that the relay cannot clean. */
export interface Uncleanable {
  /** A file the detector could not read: binary, image, too large. */
  readonly unanalysed: boolean;
  /** Invisible characters: the relay replaces secrets, not instructions. */
  readonly hidden: boolean;
  /** A scan that did not finish: the relay would refuse the request. */
  readonly incomplete: boolean;
}

export type Delegation =
  | { readonly delegate: true; readonly message: string }
  | { readonly delegate: false };

const PURGED = {
  prompt: "🧹 Secret Guard · Prompt purgé avant envoi",
  read: "🧹 Secret Guard · Fichier purgé avant envoi",
} as const;
const UNANALYSED =
  "📷 Secret Guard · Fichier transmis sans analyse (captures d’écran autorisées)";

/**
 * Whether a blocked prompt or read may go to the relay instead. A local relay
 * gets only what it can clean entirely: a refused request would stay in the
 * conversation and block every following turn.
 */
export function delegation(
  relay: LiveRelay,
  event: "prompt" | "read",
  seen: Uncleanable,
): Delegation {
  if (relay.kind === "gateway")
    return { delegate: true, message: PURGED[event] };
  if (seen.hidden || seen.incomplete) return { delegate: false };
  if (seen.unanalysed && relay.unanalysed !== "allow")
    return { delegate: false };
  return {
    delegate: true,
    message: seen.unanalysed ? UNANALYSED : PURGED[event],
  };
}
