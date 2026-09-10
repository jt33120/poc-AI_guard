# AI Guard POC — heritage correction review

## Boundary

The user rejected corporate repositioning and the previous visual direction. AI
Guard is explicitly an experimental POC from xSOM, a cybersecurity IT services
firm. The public product introduction is now organised around employees,
developers and confidential documents. Cloud/internal choices describe a possible
architecture, not a connected service. Web ChatGPT/Claude subscriptions are not
automatically covered. No backend, authentication or profile identifier changed.

The original implementation guidance, 23 illustrated threat rows, generated
coverage map and replay evidence remain publicly accessible at `/evidence`.
Technical detail is secondary, not deleted or weakened. Profile labels in the
existing diagnostic use ordinary language while keeping P1a–P5 unchanged.

## Visual direction and assets

Both themes use the shared blue/silver tokens, original company mark, Manrope
headings and Source Sans 3 body. The hero uses the root-sourced generated
infrastructure illustration, labelled as an illustrative scenario. Interactive
DOM labels and arrows explain the example; the image is not a real deployment
screenshot. No new dependency or remote runtime asset was introduced.

## Pass 1

Rendered 390, 768 and 1440 widths in both light and dark themes. All six pages
were free of horizontal overflow. Structure and softer typography are readable;
the first screen identifies the POC, scope and one main next step. The usage
explorer replaces long technical lists with three audience choices, concise
examples and an explicit flow.

Critique: the initial CSS perspective grid extended into the result area; the
mobile destination label overlapped the core label. The initial CSS-only chip
also lacked the materiality the user requested. Replaced that drawing with the
shared 3D still, clipped its own stage and aligned three independent DOM labels
along the lower edge. Removed unused decorative CSS.

## Pass 2

Recaptured all six viewport/theme combinations, plus the confidential-data /
internally-hosted selection in each combination. No horizontal overflow or page
runtime exceptions. Reviewed desktop light, mobile dark and tablet dark data
view directly: hero labels no longer overlap, important text remains outside the
image, diagram and narrative have clear hierarchy. Mobile deliberately crops
the illustration while retaining all three readable path labels.

Screenshots are in `/tmp/poc-heritage-pass2-{width}-{theme}.png` and
`/tmp/poc-heritage-data-{width}-{theme}.png`. Before captures use `pass1`.

## States and interaction

- Landing and explorer use local illustrative state: no network request, fake
  loading or invented data. Empty input is not a valid scenario; one explicit
  default is selected.
- Three hero examples update the request, rule, target and limitation together.
- Audience controls and destination radios update text and the diagram; all
  controls are native keyboard-operable elements with visible focus.
- Motion is a single finite arrow draw after selection. OS and saved reduced
  motion disable it; nothing loops at rest.
- Diagnostic empty, loading and network-error states were captured at 390px.
  A rejected fetch previously left the form busy forever; `try/catch/finally`
  now restores its submit button and displays the existing translated error.
  No diagnostic was submitted to production.
- The diagnostic capture also exposed inherited white form labels on the new
  light default. Added a diagnostic-scoped stylesheet using shared text,
  surface, border and semantic-error tokens. Retested at all three widths in
  both themes; the text now follows the active theme. Final captures use
  `/tmp/poc-heritage-triage-final-{width}-{theme}.png`.
- Existing evidence tests and new landing regression tests are owned by the
  verification agent; release results are recorded in the final delivery report.

Local `npm run typecheck` and `npm run lint` passed after implementation.
