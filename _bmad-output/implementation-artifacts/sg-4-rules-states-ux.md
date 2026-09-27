# Story SG.4: Designed states for the custom rules (P3)

Status: review

## Story

As a developer on an Équipe workstation,
I want to understand in a glance whether xSOM custom rules protect me,
so that a refused or expired tuning never goes unnoticed and a Local user knows it exists.

## Acceptance Criteria

1. Every state is designed, rendered in the tooltip and dashboard, and tested: none (Local),
   valid, expired (still applied), refused (with the reason in plain French), build without
   authority key, sync error (last verified pack kept).
2. Few words, VS Code theme tokens only, no new colour; the tooltip keeps its 7 controls and
   its VS Code sanitizer constraints.
3. Hook and scan messages name the detector label (« Identifiant client ACME ») and never the
   value.
4. A discreet way to request a tuning for Local users; no checkbox, no user-editable rule.
