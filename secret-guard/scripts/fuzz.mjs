import { redactAndRescan, scan } from "@xsom/secret-guard-core";

const ITERATIONS = 100_000;
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-=:/ .\n\t";
let state = 0x51ec7a11;

function randomIndex(maximum) {
  state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
  return state % maximum;
}

function randomText(maximumLength) {
  const length = randomIndex(maximumLength + 1);
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += ALPHABET[randomIndex(ALPHABET.length)];
  }
  return value;
}

const canary = `ghp_${"Fz7".repeat(12)}`;
for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
  const family = iteration % 8;
  const content =
    family === 0
      ? randomText(256)
      : family === 1
        ? `PASSWORD=${randomText(64)}`
        : family === 2
          ? `token: object.${randomText(24).replaceAll(/[^A-Za-z0-9_$]/g, "x")}`
          : family === 3
            ? `prefix ${canary} suffix`
            : family === 4
              ? `g\nhp_${canary.slice(4)}`
              : family === 5
                ? btoa(`API_KEY=${randomText(48)}`)
                : family === 6
                  ? `ＰＡＳＳＷＯＲＤ=${randomText(48)}`
                  : `${randomText(96)}\u200b${randomText(96)}`;

  const result = scan({ content });
  if (!result.complete)
    throw new Error(`unexpected incomplete scan at ${iteration}`);
  for (const finding of result.findings) {
    if (
      finding.span.start.offset < 0 ||
      finding.span.end.offset < finding.span.start.offset ||
      finding.span.end.offset > content.length
    ) {
      throw new Error(`invalid finding span at ${iteration}`);
    }
  }
  if (content.includes(canary)) {
    if (result.decision !== "BLOCK")
      throw new Error(`strong canary bypass at ${iteration}`);
    const serialized = JSON.stringify(result);
    if (serialized.includes(canary))
      throw new Error(`serialized canary disclosure at ${iteration}`);
  }

  if (iteration % 97 === 0) {
    const repeated = scan({ content });
    if (JSON.stringify(result) !== JSON.stringify(repeated))
      throw new Error(`non-deterministic result at ${iteration}`);
    const sanitized = redactAndRescan({ content });
    if (sanitized.content !== "" && sanitized.final.decision !== "ALLOW")
      throw new Error(`unsafe sanitized output at ${iteration}`);
  }
}

process.stdout.write(`Deterministic fuzz cases: ${ITERATIONS}\n`);
