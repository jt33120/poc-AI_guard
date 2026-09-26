import { readFile } from "node:fs/promises";
import {
  qualityGateAllows,
  validateQualityReceipt,
} from "../packages/runner/dist/index.js";

const [, , file, commit] = process.argv;
if (!file || !commit)
  throw new Error("usage: verify-quality-receipt.mjs FILE EXPECTED_SHA");
const receipt = validateQualityReceipt(
  JSON.parse(await readFile(file, "utf8")),
  commit,
);
if (!qualityGateAllows(receipt)) throw new Error("quality receipt rejected");
process.stdout.write(`Quality receipt accepted for ${commit}\n`);
