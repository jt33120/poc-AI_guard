# xSOM — heritage blue correction

## Current authority and content boundary
The user's correction supersedes the previous Signal creative brief. xSOM remains
an engineering services company specialised in cybersecurity. AI Guard is an
experimental proof of concept supporting the firm's gradual AI transition, not
its central corporate offer.

Corporate copy source: commit `a9dfd3c`, before the Signal redesign. Preserve its
headings, paragraphs, services, facts, client references and French/English
meaning. Layout and presentation may change; messaging must not be rewritten.
Explicit exception: remove AI Guard mentions, calls to action and search exposure
from the corporate site. Previous public POC URLs redirect without advertising it.

## Current visual direction
Recognisable, reassuring and contemporary. Restore the original blue/grey logo
assets exactly; never recolour or redraw their arrows. Deep ink blue, slate,
silver and cool off-white replace the warm charcoal/olive palette. Blue is the
primary interaction colour. Copper remains secondary, never the dominant brand
colour. The default corporate surface is light, with deliberate navy hero/diagram
sections; both existing user themes remain supported.

Headings: Manrope variable, softer and less condensed than Saira. Body: Source
Sans 3 variable. JetBrains Mono is reserved for technical identifiers and small
diagram labels, not every navigation item. Local WOFF2 only, with redistribution
licences retained. Semantic state colours stay distinct from brand colours.

## Current visual mechanisms
A sourced, generated 3D infrastructure still anchors the corporate hero. It is an
illustration, not a customer system or screenshot. Separate DOM/SVG controls let
visitors explore network, cyber resilience and data paths with keyboard access.
Perspective and packet movement are user-driven and stop at rest. The asset never
contains a fake logo, text, statistics or interface.

The POC landing is independently reworked around concrete usage: developers,
employees in large organisations, confidential documents, OpenAI/Claude services
and open-weight models hosted internally. Diagrams, arrows, selectable paths and
concise lists come before prose. Backend profile IDs and actual guarantees stay
unchanged. Personal web subscriptions are not automatically covered by an API
gateway; selecting a diagram is not a real connection or approval. Implementation
details and existing evidence remain accessible on secondary routes/disclosures.

## Current implementation and acceptance
Root owns shared tokens/fonts/logo, the hero asset, synchronisation and release.
Corporate owns original-copy restoration and layout. Console owns public landing,
usage explorer and scoped onboarding language. Verification owns content invariants
and regression tests. No backend/auth rewrite or workflow changes.

- Preserve the original corporate message, with an explicit AI Guard removal diff.
- Restore original blue/grey logo in both fronts, not a recoloured derivative.
- Two visual passes at 390/768/1440 in both themes; error/loading/empty/dense states.
- Keyboard, focus, 44px targets and reduced motion; no false protection claims.
- Verify tests, then merged SHA, public routes/assets and backend readiness.

---

## Retained engineering constraints

Keep static HTML/GitHub Pages and Next.js 14. Share a dependency-free, versioned
design-system directory, not a new framework. The rejected visual specification
remains available in Git history; it is not an active design instruction.

## Source of truth
`design-system/design/tokens.json` generates `design-system/tokens.css`. This placement adapts the frontend-quality token convention to the explicitly requested portable package. Both repositories consume the exact same package; its build/check command detects drift. Product layout styles may add semantic layout variables to the package, never redefine brand colors.

## Components
Shared: Button, Toggle, VerdictBadge, Card/Bento, Table, Tabs, Toast, Modal, Input, Nav/Footer primitives; AuthorizationFlow, AuditChain, RiskMeter, SovereigntyMap, PolesLockin, MissionTimeline, VideoHover/SignalVideo, ThemeToggle/SignalPreferences, ApprovalCountdown. Functional diagrams are authored SVG/HTML as explicitly requested, not decorative illustrations. Existing logo and existing interface glyphs are the declared asset sources.

Corporate: editorial hero, asymmetric expertise bento, evidence strip, contact form. Console: topbar + sidebar + canvas, Inspector narrative strip, approval queue, filtered audit, policy YAML + readable decisions, tenant administration, risk and settings.

## Motion and accessibility
OS reduced-motion always wins; an explicit visible control may reduce further. No perpetual resting animation. Pointer motion has keyboard equivalents. Focus and 44px targets, text labels for every verdict, no color-only meaning. Sound starts off and is synthesized locally only after consent. All illustrative data is visibly labeled demonstration. No UI claims cryptographic verification without server evidence.

## Delivery checks
Capture 390/768/1440 widths in dark/light, critique then correct and recapture. Check keyboard, loading, empty, error and dense states; essential live-action contracts; FR/EN; local assets; SEO and contact; existing test suite. Preserve API auth, tenant/role and server authority. Merge only after proportionate checks and review.
