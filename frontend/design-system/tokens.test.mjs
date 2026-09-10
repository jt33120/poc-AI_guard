import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeVerdict } from "./signal.js";
test("Shared components cannot introduce a second color palette", async () => {
  const css = await readFile(new URL("./components.css", import.meta.url), "utf8");
  assert.equal(/#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(css), false);
  assert.ok(css.includes("prefers-reduced-motion"));
  assert.ok(css.includes(":focus-visible"));
  assert.ok(css.includes("var(--signal-touch)"));
});
const tokens = JSON.parse(
  await readFile(new URL("./design/tokens.json", import.meta.url), "utf8"),
);
test("API verdicts never turn a held or unknown action into permission", () => {
  for (const value of ["human_in_the_loop", "human_dual", "hitl_pending"])
    assert.equal(normalizeVerdict(value), "hitl");
  for (const value of ["hitl_denied", "denied", "DENY"])
    assert.equal(normalizeVerdict(value), "deny");
  for (const value of [null, undefined, "", "unexpected"])
    assert.equal(normalizeVerdict(value), "unknown");
  assert.equal(normalizeVerdict("hitl_approved"), "approved");
});
const luminance = (hex) => {
  const rgb = hex
    .slice(1)
    .match(/../g)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (a, b) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
test("Both themes meet AAA body and AA semantic/text contrast", () => {
  for (const theme of ["dark", "light"]) {
    const t = tokens[theme];
    for (const background of [
      "signal-bg",
      "signal-surface",
      "signal-elevated",
    ]) {
      for (const foreground of ["signal-text", "signal-muted"])
        assert.ok(
          contrast(t[foreground], t[background]) >= 7,
          `${theme} ${foreground}/${background} AAA`,
        );
      for (const foreground of [
        "signal-faint",
        "signal-accent-text",
        "signal-allow",
        "signal-notify",
        "signal-hitl",
        "signal-deny",
        "signal-drift",
        "signal-taint",
        "signal-quarantine",
      ])
        assert.ok(
          contrast(t[foreground], t[background]) >= 4.5,
          `${theme} ${foreground}/${background} AA`,
        );
    }
    assert.ok(
      contrast(t["signal-accent-ink"], t["signal-accent"]) >= 4.5,
      "Primary button text AA",
    );
  }
});
test("Brand accent, local typography, spacing and readable state names are stable", () => {
  assert.equal(tokens.dark["signal-accent"], "#3f93ff");
  assert.equal(tokens.light["signal-accent"], "#195dad");
  assert.match(tokens.tokens["signal-font-display"], /Manrope/);
  assert.match(tokens.tokens["signal-font-body"], /Source Sans 3/);
  assert.equal(tokens.tokens["signal-touch"], "44px");
  for (const [key, value] of Object.entries(tokens.tokens).filter(([key]) =>
    key.startsWith("sp-"),
  ))
    assert.equal((parseFloat(value) * 16) % 4, 0, key);
  for (const state of [
    "allow",
    "notify",
    "hitl",
    "deny",
    "drift",
    "taint",
    "quarantine",
  ])
    assert.ok(tokens.dark[`signal-${state}`]);
});
