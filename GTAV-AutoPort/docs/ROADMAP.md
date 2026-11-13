# Roadmap

## Phase 0 — workspace
- [x] Isolated folder and development branch created.
- [x] React/Vite desktop-workbench UI scaffold.
- [ ] Tauri desktop shell and CI.

## Phase 1 — vehicle metadata importer
- [x] ZIP archive intake and file inventory.
- [x] Reject absolute/traversal paths, symlinks, duplicate paths, and oversized archives.
- [x] Parse GTA V vehicle and handling metadata.
- [x] Select exactly one target vehicle entry.
- [x] Resolve matching handling ID.
- [x] Check expected model and texture dependencies.
- [x] Produce downloadable SHA-256 conversion manifest.
- [ ] Folder, RAR, and 7z intake.
- [ ] Deep dependency resolution across DLC metadata.
- [ ] Tests for hostile archives and real fixture files.

## Phase 2 — YFT/YTD inspection
- [x] Basic RSC7 signature identification.
- [ ] Read-only container structure inspection.
- [ ] Document PC vs PS4 format differences from legitimate test fixtures.
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
