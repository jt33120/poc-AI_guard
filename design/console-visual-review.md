# Console visual review

## Scope and method

Next.js production build, Chromium, 390 / 768 / 1440 px, dark and light. The
browser-only QA fixtures are explicitly demonstration records; no customer data,
production session, token or side-effectful tool call is used. API route mocks
exercise real rendered pages and the unchanged request contracts.

Screens: home, inspector, approvals, audit, policy, risk, settings, onboarding,
admin, costs and executive. Public auth surfaces also consume the same tokens.
The browser captures all 11 operational screens at all three widths and in both
themes. Functional tests independently cover loading, empty, failure, dense rows,
expiry, server-confirmed decisions, keyboard controls and translation.

## Pass 1

66 full-page captures. No browser page errors or document-level horizontal
overflow. Wide audit/matrix tables intentionally scroll inside their own panel.

The hierarchy works: one page title, narrow numbered navigation, discrete
operational panels, monospaced tool IDs. The inspector retains master/detail at
768 px and stacks at 390 px. Approval actions remain reachable below their dry-run
and expiration time on mobile. Both themes keep visible boundaries and body text.

Corrections from the rendered review:

- Primary buttons inherited a light canvas alias as text in light mode. Use the
  shared `signal-accent-ink` token for stable contrast on copper.
- Existing provider glyphs formed an unrelated rainbow and were invented marks.
  Replace them with neutral text identifiers; do not imply official logos.
- Tool-integrity status `ok` was displayed as `allow`, which could be mistaken for
  action permission. Keep the actual integrity status label.
- Existing daily cost bars had percentage heights inside an unbounded parent and
  an ineffective variable-color opacity utility. Give the chart a token-defined
  track and explicit shared copper fill. Numeric values stay visible without hover.
- Use explicit semantic colors for executive decision bars in both themes.
- Remove the promotional tail from the live executive view; retain the public
  snapshot composition. Live labels describe registry and event counts rather
  than claims about all possible actions or compliance.
- Give settings controls their own padding and keep session links off panel edges.
- An early QA client fixture omitted rollup fields and produced `NaN`; fix the
  fixture against the actual `Client` contract rather than changing valid API data.

## Review of meaning and authority

The inspector never executes tools. Its live diagram shows an effective rule and
the narrative uses recorded event metadata. No downstream effect is inferred from
a verdict alone. Audit sequence blocks are not labeled cryptographically verified:
the current API omits the chain hashes. Missing risk values stay unknown. Approval
expiry disables controls locally; only the server confirms a decision. Policy
defaults refer to the saved YAML, including monitor configurations. Editing is
locked while a policy save or draft request is in flight to preserve user changes.

## Pass 2 and state coverage

The corrected production build produced 66 further full-page captures across the
same 11 screens, three widths and both themes. All captures had zero browser page
errors and no document-level horizontal overflow. The inspector at 1440 px dark,
approvals at 768 px light and settings at 390 px dark also received independent
peer visual review.

Additional state captures covered API failures (24 captures), genuinely empty
data (16 captures) and loading (16 captures), at 390 and 1440 px in both themes.
All 56 captures passed the same browser-error and document-overflow checks. Errors
remain distinct from empty data, and unavailable numbers are not rendered as zero.

The final evidence review also found that unrecognized audit decisions inherited
the authorization bucket in the executive view. This was replaced with an
explicit decision whitelist aligned with `core/export.py`. Guard events, monitor
observations, uninspected traffic and unknown decisions are counted separately as
other events, with a note that they are excluded from the decision distribution.
The authorization count cannot silently absorb a newly introduced decision.

Six final executive captures at all three widths and both themes verified the
mixed fixture: one authorization, one HITL event, one refusal and six other
events. The explicit exclusion note remains readable on mobile. A retained
marketing subtitle was replaced with a neutral description of recorded evidence;
the live chart heading now states the loaded-event scope. The public executive
snapshot keeps its separate demonstration presentation.
