import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@xsom/secret-guard-cli/hook": fileURLToPath(
        new URL("./packages/cli/src/hook.ts", import.meta.url),
      ),
      "@xsom/secret-guard-core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 5_000,
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**/*.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 85,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
