export interface DataPolicy {
  readonly maximumBytes: number;
  readonly allowBinary: boolean;
}

export interface DataDecision {
  readonly allowed: boolean;
  readonly reason?: "file_too_large" | "binary_content";
}

export const DEFAULT_DATA_POLICY: DataPolicy = {
  maximumBytes: 1_000_000,
  allowBinary: false,
};

export function evaluateData(
  size: number,
  sample: Uint8Array,
  policy: DataPolicy = DEFAULT_DATA_POLICY,
): DataDecision {
  if (!Number.isSafeInteger(size) || size < 0 || size > policy.maximumBytes)
    return { allowed: false, reason: "file_too_large" };
  if (!policy.allowBinary && sample.includes(0))
    return { allowed: false, reason: "binary_content" };
  return { allowed: true };
}
