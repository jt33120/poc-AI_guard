import { FIXED_RULE_IDS, scan } from "@xsom/secret-guard-core";

const check = process.argv.includes("--check");
const ALPHANUMERIC =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const HEX = "0123456789abcdef";
const BASE64 = `${ALPHANUMERIC}+/`;

let state = 0x5ec7e7;
function randomIndex(maximum) {
  state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
  return state % maximum;
}

function generated(alphabet, length) {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += alphabet[randomIndex(alphabet.length)];
  }
  return value;
}

function base64Url(value) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replaceAll("=", "")
    .replaceAll("+", "-")
    .replaceAll("/", "_");
}

const positiveFamilies = [
  [
    "github_fine_grained_pat",
    () => `github_pat_${generated(ALPHANUMERIC, 50)}`,
  ],
  ["github_token", () => `ghp_${generated(ALPHANUMERIC, 36)}`],
  ["gitlab_pat", () => `glpat-${generated(ALPHANUMERIC, 28)}`],
  ["openrouter_key", () => `sk-or-v1-${generated(ALPHANUMERIC, 40)}`],
  ["anthropic_key", () => `sk-ant-api03-${generated(ALPHANUMERIC, 40)}`],
  ["openai_key", () => `sk-proj-${generated(ALPHANUMERIC, 40)}`],
  ["stripe_secret_key", () => `sk_live_${generated(ALPHANUMERIC, 32)}`],
  [
    "slack_token",
    () => `xoxb-${generated(ALPHANUMERIC, 16)}-${generated(ALPHANUMERIC, 32)}`,
  ],
  [
    "slack_webhook",
    () =>
      `https://hooks.slack.com/services/${generated(ALPHANUMERIC, 12)}/${generated(ALPHANUMERIC, 12)}/${generated(ALPHANUMERIC, 32)}`,
  ],
  ["google_api_key", () => `AIza${generated(ALPHANUMERIC, 35)}`],
  ["google_oauth_token", () => `ya29.${generated(ALPHANUMERIC, 48)}`],
  [
    "sendgrid_key",
    () => `SG.${generated(ALPHANUMERIC, 22)}.${generated(ALPHANUMERIC, 43)}`,
  ],
  ["npm_token", () => `npm_${generated(ALPHANUMERIC, 36)}`],
  ["huggingface_token", () => `hf_${generated(ALPHANUMERIC, 40)}`],
  ["databricks_pat", () => `dapi${generated(HEX, 32)}`],
  ["digitalocean_token", () => `dop_v1_${generated(HEX, 64)}`],
  ["shopify_token", () => `shpat_${generated(HEX, 32)}`],
  ["azure_storage_key", () => `AccountKey=${generated(BASE64, 64)}=`],
  [
    "aws_access_key_id",
    () =>
      `AWS_ACCESS_KEY_ID=AKIA${generated("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 16)}\nAWS_SECRET_ACCESS_KEY=${generated(ALPHANUMERIC, 40)}`,
  ],
  [
    "jwt",
    () =>
      `${base64Url('{"alg":"HS256","typ":"JWT"}')}.${base64Url(`{"sub":"${generated(ALPHANUMERIC, 12)}"}`)}.${generated(ALPHANUMERIC, 43)}`,
  ],
  [
    "private_key_pem",
    () =>
      `-----BEGIN PRIVATE KEY-----\n${generated(BASE64, 192)}\n-----END PRIVATE KEY-----`,
  ],
  [
    "database_url_credentials",
    () => `postgresql://app:${generated(ALPHANUMERIC, 24)}@db.internal/service`,
  ],
  ["contextual_password", () => `PASSWORD=${generated(ALPHANUMERIC, 24)}`],
];

const positiveFailures = [];
let positiveCount = 0;
let trueBlocks = 0;
for (const [ruleId, makeContent] of positiveFamilies) {
  for (let sample = 0; sample < 50; sample += 1) {
    positiveCount += 1;
    const result = scan({ content: `synthetic fixture\n${makeContent()}` });
    const detected = result.findings.some(
      (finding) => finding.ruleId === ruleId,
    );
    if (result.decision === "BLOCK") trueBlocks += 1;
    if (!result.complete || result.decision !== "BLOCK" || !detected) {
      positiveFailures.push({
        ruleId,
        sample,
        decision: result.decision,
        detectedRuleIds: result.findings.map((finding) => finding.ruleId),
      });
    }
  }
}

const negativeFactories = [
  () =>
    `${generated(HEX, 8)}-${generated(HEX, 4)}-4${generated(HEX, 3)}-a${generated(HEX, 3)}-${generated(HEX, 12)}`,
  () => generated(HEX, 64),
  () => `sha512-${generated(BASE64, 86)}==`,
  () => generated("0123456789ABCDEFGHJKMNPQRSTVWXYZ", 26),
  () => `pk_live_${generated(ALPHANUMERIC, 32)}`,
  () => `acct_${generated(ALPHANUMERIC, 24)}`,
  () => `PASSWORD=\${SECRET_${generated("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 6)}}`,
  () =>
    `SERVICE_HOST=service-${generated("abcdefghijklmnopqrstuvwxyz", 10)}.internal`,
  () =>
    `https://service-${generated("abcdefghijklmnopqrstuvwxyz", 8)}.example.test/api`,
  () =>
    `Documentation sample ${generated(ALPHANUMERIC, 12)} is not a credential.`,
  () => ({
    content: "const password: string = form.password;",
    languageId: "typescript",
  }),
  () => ({ content: "password: z.string().min(8)", languageId: "typescript" }),
  () => ({
    content: "token: vscode.CancellationToken",
    languageId: "typescript",
  }),
  () => ({ content: "apiKey: process.env.API_KEY", languageId: "typescript" }),
  () => "api_key = var.api_key",
  () => "csrfToken: null",
  () => "tokenizer: bert-base-uncased",
  () => 'jsonwebtoken: "^9.0.2"',
  () => 'js-tokens: "^9.0.0"',
  () => ({
    content: "const PASSWORD = parsed.password ?? null",
    languageId: "typescript",
  }),
  () => ({
    content: "const API_KEY = Deno.env.get('API_KEY')",
    languageId: "typescript",
  }),
  () => ({
    content: "const TOKEN = /[A-Za-z0-9_-]{20,512}/g",
    languageId: "typescript",
  }),
  () => "Cookie: theme=dark; locale=fr",
  () => "curl --user-agent secret-guard/1.0 https://example.test",
  () => "PUBLIC_SIGNING_KEY=publicKey.value",
  () =>
    `const value = { token: tokenValue${generated("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 6)} };`,
  () =>
    `const { password: userPassword${generated("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 6)} } = form;`,
  () => ({
    content: `accessToken: await vault${generated("abcdefghijklmnopqrstuvwxyz", 5)}.get()`,
    languageId: "typescript",
  }),
  () => ({ content: "password: string | null", languageId: "typescript" }),
  () => ({ content: "password: str | None", languageId: "python" }),
  () => ({ content: "password: String!", languageId: "typescript" }),
  () => '{"password":{"type":"string"}}',
  () => 'enum Field { AccessToken = "access_token" }',
  () => "return password === input.password",
  () => "PASSWORD=${{ secrets.PASSWORD }}",
  () => "Cookie: sessionid=<redacted>; theme=dark",
];

const negativeFailures = [];
const negativeCount = 50_000;
let falseBlocks = 0;
let falseWarnings = 0;
for (let sample = 0; sample < negativeCount; sample += 1) {
  const family = sample % negativeFactories.length;
  const generatedNegative = negativeFactories[family]();
  const input =
    typeof generatedNegative === "string"
      ? { content: generatedNegative }
      : generatedNegative;
  const result = scan(input);
  if (!result.complete || result.decision === "BLOCK") falseBlocks += 1;
  if (result.decision === "WARN") falseWarnings += 1;
  if (result.decision !== "ALLOW" && negativeFailures.length < 20) {
    negativeFailures.push({
      family,
      sample,
      decision: result.decision,
      ruleIds: result.findings.map((finding) => finding.ruleId),
    });
  }
}

const recall = (positiveCount - positiveFailures.length) / positiveCount;
const precision = trueBlocks / (trueBlocks + falseBlocks || 1);
const falseBlockRate = falseBlocks / negativeCount;
const falseWarningRate = falseWarnings / negativeCount;
const effectiveRejectRate = (falseBlocks + falseWarnings) / negativeCount;

function wilsonUpperBound(successes, total, z = 1.959963984540054) {
  const rate = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = rate + (z * z) / (2 * total);
  const margin =
    z * Math.sqrt((rate * (1 - rate)) / total + (z * z) / (4 * total * total));
  return (center + margin) / denominator;
}

const falseBlockUpper95 = wilsonUpperBound(falseBlocks, negativeCount);
const effectiveRejectUpper95 = wilsonUpperBound(
  falseBlocks + falseWarnings,
  negativeCount,
);
const coveredRuleIds = new Set(positiveFamilies.map(([ruleId]) => ruleId));
const uncoveredFixedRules = FIXED_RULE_IDS.filter(
  (ruleId) => !coveredRuleIds.has(ruleId),
);

process.stdout.write(
  [
    `Synthetic detector positives: ${positiveCount}`,
    `Synthetic negative mutations: ${negativeCount}`,
    `Observed synthetic recall: ${(recall * 100).toFixed(3)}%`,
    `Observed synthetic BLOCK precision: ${(precision * 100).toFixed(3)}%`,
    `Observed synthetic false BLOCK rate: ${(falseBlockRate * 100).toFixed(3)}%`,
    `Observed synthetic false WARN rate: ${(falseWarningRate * 100).toFixed(3)}%`,
    `Observed synthetic default-hook reject rate: ${(effectiveRejectRate * 100).toFixed(3)}%`,
    `Wilson 95% upper bound (synthetic false BLOCK samples only): ${(falseBlockUpper95 * 100).toFixed(3)}%`,
    `Wilson 95% upper bound (synthetic reject samples only): ${(effectiveRejectUpper95 * 100).toFixed(3)}%`,
    `Fixed detector catalog coverage: ${FIXED_RULE_IDS.length - uncoveredFixedRules.length}/${FIXED_RULE_IDS.length}`,
    "Population-level precision/recall: not established by this synthetic gate",
  ].join("\n") + "\n",
);

if (positiveFailures.length > 0) {
  process.stderr.write(
    `Positive failures (without fixture values): ${JSON.stringify(positiveFailures.slice(0, 20))}\n`,
  );
}
if (negativeFailures.length > 0) {
  process.stderr.write(
    `Negative failures (without fixture values): ${JSON.stringify(negativeFailures)}\n`,
  );
}
if (uncoveredFixedRules.length > 0) {
  process.stderr.write(
    `Uncovered fixed detector IDs: ${JSON.stringify(uncoveredFixedRules)}\n`,
  );
}

if (
  check &&
  (recall < 0.99 ||
    precision < 0.995 ||
    falseBlockRate > 0.001 ||
    effectiveRejectRate > 0.005 ||
    uncoveredFixedRules.length > 0)
) {
  process.stderr.write("Secret Guard evaluation gate failed.\n");
  process.exitCode = 1;
}
