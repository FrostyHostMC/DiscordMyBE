# AutoBE Compatibility Mode: Switcher Design

## Status

**Long-term design only — not implemented by the animation analyzer PR.**

The standard merger remains the default path. Compatibility Mode is a fallback for cases where analysis shows that direct merging is unsafe or cannot preserve both animation systems.

## Goals

- Work with arbitrary Bedrock add-ons; do not special-case, name-check, or hardcode any particular third-party add-on.
- Preserve the existing standard merge behavior and its regression checks.
- Use analyzer findings to explain the risk and offer a deliberate choice: **Attempt standard merge** or **Use Compatibility Mode (Switcher)**.
- Keep source modules isolated where possible instead of blindly combining conflicting player animation definitions.
- Never describe a potential overlap as a guaranteed runtime failure without sufficient evidence.

## Proposed Switcher architecture

1. **Analyze.** Inspect entity identifiers, animation references, controller states, and affected bones. Classify findings as player, mob, or unknown. Ambiguous references stay unknown.
2. **Plan modules.** Group the relevant source animation systems into isolated, traceable modules. Record provenance so diagnostics can explain which source contributed each module.
3. **Generate a gatekeeper.** Only for a supported player-animation compatibility plan, generate a controller that selects the active module and avoids activating incompatible animation branches together.
4. **Generate a selector interaction.** Optionally provide a generated in-game “Style Selector” item or another supported user interaction to change the selected module.
5. **Connect selection to runtime state.** Use a Bedrock-supported mechanism for storing and changing the selected style. A scoreboard is one candidate, not an assumed universal solution: item-use events, script APIs, permissions, and target game versions must be validated before selecting the implementation.
6. **Validate and report.** Check generated identifiers, controller/state references, item definitions, scripts or functions, and version requirements. Include the compatibility plan and limitations in the merge report.
7. **Keep the standard output available.** Compatibility Mode must be an explicit alternative or clearly explained recommendation, not a silent replacement of normal merging.

## Safety and correctness constraints

- Do not inject a second conflicting definition into player.json and assume that a gatekeeper will automatically disable all other controllers.
- A gatekeeper can only control references and execution paths that the generated plan actually owns or can safely integrate. Existing scripts, unconditional animation references, and external controllers may remain active.
- If AutoBE cannot prove that the switcher can isolate a conflict safely, report the limitation and do not generate a misleading “fixed” pack.
- Do not mutate the source archives. Generate new output files and preserve the original inputs.
- Keep third-party copyrighted add-on archives out of public automated tests. Use small synthetic ZIP fixtures for regression coverage.
- Keep real in-game regression checks separate from synthetic tests.

## Delivery phases

### Phase 1 — Analyzer foundation
- Detect animation/controller overlaps using parsed references and actual bone targets.
- Classify player, mob, and unknown scope conservatively.
- Make ambiguous-reference handling deterministic.
- Emit actionable diagnostics without overclaiming that static analysis can prove runtime behavior.

### Phase 2 — Logic hardening
- Cover scope inference, controller aliases and targets, shared bones, malformed JSON, and ambiguous references with synthetic regression tests.
- Verify tests, typecheck, and build in CI.
- Preserve the existing successful direct-merge baseline as a manual in-game regression check without embedding the add-ons in the repository.

### Phase 3 — Switcher prototype
- Define explicit eligibility rules for conflicts the Switcher can actually isolate.
- Design module boundaries and generated identifiers.
- Verify a supported selection mechanism for the target Bedrock versions.
- Generate the selector item and gatekeeper only when all required integration points are supported.
- Compare the resulting pack in-game against the direct-merge path and report unsupported cases honestly.

## Acceptance criteria for Compatibility Mode

- No third-party add-on names or identifiers are hardcoded into analyzer or generator logic.
- The user can understand why Compatibility Mode is offered and what limitations apply.
- The generated modules and switcher logic are traceable to their source packs.
- Selecting one style does not intentionally run another isolated style's controlled animation branch at the same time.
- Unsupported or ambiguous integrations fail safely with diagnostics instead of silently producing a false promise of compatibility.
- The ordinary standard merge path remains available and is not changed for unrelated add-ons.
