import { build } from "esbuild";

const common = {
  bundle: true,
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
