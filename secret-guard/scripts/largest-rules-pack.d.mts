import type { RulesPackPayload } from "@xsom/secret-guard-core";

export declare function largestRulesPack(options?: {
  sharedSalt?: boolean;
}): RulesPackPayload;
export declare function largestPackCanary(): string;
