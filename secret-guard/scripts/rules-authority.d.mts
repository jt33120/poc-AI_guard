export declare const TEST_AUTHORITY_PUBLIC_KEYS: readonly string[];
export declare function authorityKeyId(publicKey: string): string;
export declare function readAuthorityKeys(
  env?: Record<string, string | undefined>,
): string[];
