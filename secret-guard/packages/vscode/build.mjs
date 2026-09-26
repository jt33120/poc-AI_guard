import { build } from "esbuild";

import {
  authorityKeyId,
  readAuthorityKeys,
} from "../../scripts/rules-authority.mjs";

// The xSOM rules authority is part of the build, never of the runtime: no
// setting, file or environment variable of the workstation can add a key.
const authorityKeys = readAuthorityKeys();
process.stdout.write(
  authorityKeys.length === 0
    ? "Rules authority: no key — this build refuses every rules pack.\n"
    : `Rules authority: ${String(authorityKeys.length)} key(s): ${authorityKeys.map((key) => authorityKeyId(key).slice(0, 12)).join(", ")}\n`,
);

const common = {
  bundle: true,
  define: {
    __XSOM_RULES_AUTHORITY_KEYS__: JSON.stringify(authorityKeys.join(",")),
  },
  logLevel: "info",
  minify: false,
  platform: "node",
  sourcemap: false,
  target: "node20",
};

await Promise.all([
  build({
    ...common,
    entryPoints: ["src/extension.ts"],
    external: ["vscode"],
    format: "cjs",
    outfile: "dist/extension.cjs",
  }),
  build({
    ...common,
    entryPoints: ["src/hook-entry.ts"],
    format: "cjs",
    outfile: "dist/hook.cjs",
  }),
  build({
    ...common,
    entryPoints: ["src/test/suite/index.ts"],
    external: ["mocha", "vscode"],
    format: "cjs",
    outfile: "dist/test/suite/index.cjs",
  }),
]);
