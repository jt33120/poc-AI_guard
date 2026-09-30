import { build } from "esbuild";

// The open source build of Secret Guard Local: the extension and the hook
// without the Équipe edition, which build.mjs plugs in for the official
// release. No rules authority is compiled in, so no rules pack is accepted.
const common = {
  bundle: true,
  logLevel: "info",
  minify: false,
  platform: "node",
  sourcemap: false,
  target: "node20",
  format: "cjs",
};

await Promise.all([
  build({
    ...common,
    entryPoints: ["src/local-extension.ts"],
    external: ["vscode"],
    outfile: "dist/local/extension.cjs",
  }),
  build({
    ...common,
    entryPoints: ["src/local-hook.ts"],
    outfile: "dist/local/hook.cjs",
  }),
]);
