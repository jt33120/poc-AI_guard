import { rm } from "node:fs/promises";

await Promise.all(
  [
    "coverage",
    "packages/core/dist",
    "packages/cli/dist",
    "packages/vscode/dist",
  ].map((path) =>
    rm(new URL(`../${path}`, import.meta.url), {
      force: true,
      recursive: true,
    }),
  ),
);
