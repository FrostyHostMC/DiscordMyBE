# Switcher Isolation Plan: Eligibility Contract

## Status

Design and dry-run decision layer only. This contract does not generate controllers, selector items, or modify source archives. Keep Compatibility Mode uninvoked until automated checks pass and the real in-game golden baseline has been checked.

## Bedrock constraint

The Switcher must not assume it can disable another controller. Entity animation controllers are composed through entity animation references; controller-to-controller references are not a general mechanism for disabling an independently active controller. A Switcher is only feasible when every conflicting controller can be structurally inlined into one generated gatekeeper and the gatekeeper is the sole rewritable entry path for those conflicting branches.

If any conflicting controller has an unrewritable inbound path, or a required third-party dependency needs a conflicting state to remain available, the plan is blocked. A scoreboard or selector by itself does not disable animation execution.

## Analysis contract

The decision layer requires evidence from two completed passes:

1. **Fact collection:** enumerate relevant files; parse entity definitions, animation definitions, controller state graphs, geometry, manifests, scripts, timeline events, Molang references, and all inbound controller references. Missing or malformed relevant files invalidate completeness.
2. **Scope and overlap resolution:** resolve controller aliases and targets to player, mob, or unknown; identify actual overlapping bone/channel/time-window groups. Unknown remains unknown. Input order must not change the report.

A controller-name collision or shared bone name alone is not proof of a time-overlap conflict. If no bone/channel overlap group is proven, recommend standard merge rather than triggering Switcher.

## Eligibility gates, in order

1. **Reproducible evidence:** incomplete file enumeration, parse failure, unresolved controller, unknown scope, or missing overlap evidence returns `unproven`; never eligible.
2. **Bone/channel overlap:** each conflict group records exact animation IDs, controller IDs, bone, channel (position/rotation/scale), time-window evidence, source packs, and one proposed owner. Only overlapping groups require selection.
3. **Entry-point proof:** every conflicting controller must have accounted-for inbound references, a single rewritable entity animate entry path, and no external path that can independently activate it.
4. **Dependency scan:** block on timeline `sound_effects`/`particle_effects`, state `run_command`/`emit_particle`/`play_sound`, relevant Molang properties/scoreboards/script-set variables, scripts modules that reference affected animations, and other external references unless a separately validated transformation can preserve them. The report must identify each hit.
5. **Geometry sanity:** every targeted bone must exist in the geometry actually rendered by the entity. A missing bone is a geometry conflict; gating cannot fix it.
6. **Version gate:** compare declared `min_engine_version` with the selected mechanism's minimum. Property-based mechanisms need at least 1.19.60 where applicable; item-use/entity-event support must be verified against the actual target engine. Unknown version or unsupported requirement blocks the plan.
7. **State-graph rewrite proof:** parse state IDs as a graph and produce an old-state-to-new-state map. Rewrite all transition targets and `on_entry`/`on_exit` references structurally. Reset `blend_transition` on gated entry states to avoid a previous pose lingering. Never patch JSON by string replacement.
8. **Explicit confirmation:** return a readable dry-run report and require the user to confirm before any archive writes. Even after confirmation, generated output must pass structural validation.

## Frozen evidence contract

Every candidate bone/channel overlap is a structured evidence record, not a free-form assertion. The TypeScript contract is defined in
`autobe-activity/src/utils/switcherEligibility.ts` and currently requires:

- `confidence`: exactly `proven`, `possible`, or `unknown`.
- `sourceProof.filePath`: non-empty path to the exact source file in the analyzed pack.
- `sourceProof.reference`: non-empty JSON path, identifier reference, or source location establishing the claim.
- `sourceProof.claim`: non-empty concise statement of what that source proves.
- `bone`, `channel`, exact `animationIds`, `controllerIds`, `packIds`, and `overlapEvidence`.
- `blockerCodes`: stable machine-readable codes when evidence is not proven, such as `unresolved_reference`, `source_proof_missing`, `overlap_window_unproven`, or `channel_unproven`.

The contract is strict: missing or malformed proof is rejected as `unproven`. Evidence with confidence `possible` or `unknown` can never unlock Switcher; it remains `unproven` regardless of any other passing gate. Every non-proven record must carry at least one recognized blocker code. Human-readable blocker text is supplementary and does not replace the code or source receipt. Unknown is a valid diagnostic outcome, not an analyzer crash.

The evidence producer must resolve references before classifying overlaps. It must not label an overlap `proven` based only on a shared bone name or repeated controller/animation identifier. A proven record needs traceable source proof for the actual channel and overlapping time window or triggering condition.

## Report schema

The dry-run report must include:

- Decision: `not-needed`, `unproven`, `ineligible`, `needs-review`, or `eligible`.
- Exact conflicting animation and controller IDs.
- Bone/channel/time-window overlap groups and proposed owner per group.
- Controller inlining maps, renamed state IDs, and rewritten transition targets.
- All blockers with source and reason.
- Declared engine minimum and required mechanism version.
- An explicit statement that the plan is not yet an in-game guarantee and requires confirmation.

An `eligible` result is only permitted when every gate is supported by explicit evidence. The current decision function consumes caller-supplied evidence; it does not itself perform all of these scans. Do not connect it to archive generation until the analyzer provides that evidence.

## Required synthetic test matrix

- Eligible: two player-scoped controllers, disjoint entry points that can be rewritten, same proven bone/channel/time group, no external references.
- Not needed: conflicts are on disjoint bones or no actual channel/time overlap is proven.
- Ineligible: animation timeline contains `sound_effects` or `particle_effects`.
- Ineligible: controller state runs `run_command` targeting another entity.
- Ineligible: a scripts module references the affected animation.
- Ineligible: targeted bone does not exist in rendered geometry.
- Ineligible: declared `min_engine_version` is below the mechanism requirement.
- Unproven: player/mob scope ambiguity regardless of file order.
- Unproven: missing or parse-failed relevant file; no partial plan.
- Unproven: unresolved controller reference or incomplete state-graph rewrite.
- Deterministic: reversing input file/evidence order yields the same report.

## Validation boundary

Synthetic tests prove decision logic and report determinism only. They do not prove a conflict is solvable in Bedrock. Keep PR #5 and PR #6 as drafts until their checks pass; keep Switcher generation disabled until the Moose + Relic golden baseline is tested in-game and the generated controller behavior is separately validated.
