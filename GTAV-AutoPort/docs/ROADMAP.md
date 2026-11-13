# Roadmap

## Phase 0 — workspace
- [x] Isolated folder and development branch created.
- [x] Project scope and safety boundaries documented.
- [ ] Desktop app scaffold and CI.

## Phase 1 — vehicle metadata importer
- [ ] Safe ZIP/folder intake and inventory.
- [ ] XML parsing for GTA V vehicle and handling metadata.
- [ ] Select exactly one target vehicle entry.
- [ ] Resolve matching handling ID and referenced assets.
- [ ] Detect duplicate/missing references and malformed XML.
- [ ] Produce deterministic conversion manifest and review report.
- [ ] Tests for preserving unrelated metadata entries.

## Phase 2 — YFT/YTD inspection
- [ ] Read-only container inspection and structural metadata.
- [ ] Document PC vs PS4 format differences from legitimate test inputs.
- [ ] Select and test a supported conversion/rebuild strategy.

## Phase 3 — first PS4 vehicle conversion
- [ ] Convert the Crown Victoria model and texture assets for a specific PS4 game build.
- [ ] Validate model/texture references and target title ID.
- [ ] Generate loose output and deployment package only after all gates pass.
- [ ] Test on backed-up PS4 Story Mode installation.

## Phase 4 — expand
- [ ] More vehicle replacements.
- [ ] Add-on vehicle support only after dependency and DLC handling is solved.
- [ ] Additional asset categories with dedicated fixtures and regression tests.

## Non-goals
- GTA Online.
- Universal automatic conversion claims for arbitrary mods.
- Renaming PC files or repacking them as a substitute for conversion.
