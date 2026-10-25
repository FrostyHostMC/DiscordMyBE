# Switcher Test Acceptance Criteria

This document defines the minimum acceptance gate for a testable Switcher build. It does not claim that any gate has passed.

## Gate A — Synthetic generator

- [ ] Selector modes are generated deterministically from supplied controller graphs.
- [ ] Every rewritten transition target resolves to a generated state.
- [ ] Invalid/missing states and non-player-scoped inputs are rejected, not guessed.
- [ ] Generated item-use script references the namespaced item and property.
- [ ] Generator tests run as part of `npm test`, plus typecheck and production build pass.

## Gate B — Minimal importable fixture

Use two tiny resource packs with intentionally overlapping player animation behavior and one neutral third pack with an unrelated animation. Keep the fixture small enough that every file and expected effect is known.

- [ ] Build emits a real `.mcaddon` containing BP and RP manifests, valid UUIDs/dependencies, the custom item, script module/entry, and merged player definitions.
- [ ] No duplicate `minecraft:player` or client-player entity definitions are emitted.
- [ ] All injected item, property, controller, and script identifiers use a reserved AutoBE namespace and are collision-checked against source packs.
- [ ] All original files changed by integration are listed in a generation report with source path, reason, and output path.
- [ ] Pack and JSON validation passes before the archive is offered for import.

## Gate C — Minecraft runtime acceptance

Record Minecraft version, platform, behavior-pack and resource-pack activation state, and content-log output for every run.

- [ ] Switcher item is obtainable and displays a valid name and icon.
- [ ] Using it advances the selected mode.
- [ ] The visible conflicting animation changes to the selected behavior.
- [ ] The inactive conflicting controller is no longer concurrently driving the affected animation.
- [ ] Unrelated animations from the neutral third pack remain intact.
- [ ] No content-log errors or duplicate entity definition warnings appear.

## Failure attribution checklist

1. **Item missing / bad icon:** inspect item JSON, item identifier, RP texture atlas/icon mapping, BP manifest and pack activation.
2. **Item exists but use has no effect:** inspect script module dependency/version, script entry in manifest, runtime errors, event subscription, and exact item identifier.
3. **Script runs but mode does not change:** inspect property registration on the BP entity, property identifier/range, and `setProperty` errors.
4. **Mode changes but animation does not:** inspect client property sync, controller reference in the client entity, animate registration, and content log.
5. **Both conflicting behaviors still run:** inspect all `scripts.animate` entries and controller activation paths; confirm every conflicting path is inlined/gated. Do not treat a property flip alone as success.
6. **Unrelated animations break:** diff the generated report against the original player entity/controller graph and stop the test; this is a generator regression.
7. **Pack fails to load:** capture the first content-log error and validate manifest UUIDs, dependencies, format versions, JSON schema, and duplicate identifiers.

## Independent baseline

The manual Moose + Relic golden baseline is a separate gate. A passing Switcher fixture does not establish that baseline, and a passing baseline does not establish Switcher correctness.

## Status

All boxes are intentionally unchecked until evidence is recorded. Synthetic tests, CI status, archive validity, and in-game runtime behavior are separate claims.
