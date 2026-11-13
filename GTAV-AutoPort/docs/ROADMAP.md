# Roadmap

## Phase 0 — workspace
- [x] Isolated folder and development branch created.
- [x] React/Vite workbench UI.
- [x] Root GitHub Actions workflow scoped to AutoPort folder.
- [ ] Tauri desktop shell and native command integration.

## Phase 1 — intake and vehicle metadata
- [x] ZIP archive intake and file inventory.
- [x] Extracted-folder intake.
- [x] Reject absolute/traversal paths, symlinks, duplicate paths, and oversized archives.
- [x] Parse GTA V vehicle and handling metadata.
- [x] Select exactly one target vehicle entry.
- [x] Resolve matching handling ID.
- [x] Detect duplicate metadata basenames and ambiguous vehicle assets.
- [x] Check expected model and texture dependencies.
- [x] Produce downloadable SHA-256 conversion manifest.
- [ ] Deep dependency resolution across DLC metadata.
- [ ] Run automated tests against the supplied real Crown Victoria fixture in a local Rust environment.

## Phase 2 — native resource inspection
- [x] Basic RSC7 header inspection.
- [x] Native Rust YFT fragment parser adapter.
- [x] Native Rust YTD texture dictionary parser and DDS inspection export.
- [x] YFT drawable/LOD/geometry/triangle and physics-child report.
- [x] Connect native YFT/YTD JSON reports to the workbench UI.
- [x] Display YFT structure metrics for multiple LOD resources and YTD texture previews.
- [x] Add a Windows file-picker launcher that runs the native inspector on a selected YFT/YTD pair and opens the report folder.
- [x] Add a one-click local web workbench launcher.
- [ ] Replace the browser workbench launchers with a signed Tauri desktop installer and bundled native inspector.
- [ ] Inspect and validate RSC7 page flags and resource boundaries independently.
- [ ] Add real fixture integration tests (fixture binaries remain outside the repository).
- [ ] Inspect material/shader references and external texture dictionary dependencies.

## Phase 3 — first PS4 vehicle conversion
- [ ] Establish exact PS4 GTA V title ID, region, update/build and GoldHEN target profile.
- [ ] Determine PS4 YFT/YTD resource differences from verified retail PS4 files.
- [ ] Implement a real PS4-compatible YFT writer or conversion adapter.
- [ ] Implement/verify a PS4-compatible YTD writer and texture encoding path.
- [ ] Validate model/texture references and target title ID.
- [ ] Generate loose output and deployment package only after all gates pass.
- [ ] Test on a backed-up PS4 Story Mode installation.

## Phase 4 — expand
- [ ] More vehicle replacements.
- [ ] Add-on vehicle support only after dependency and DLC handling is solved.
- [ ] Additional asset categories with dedicated fixtures and regression tests.

## Non-goals
- GTA Online.
- Universal automatic conversion claims for arbitrary mods.
- Renaming PC files or repacking them as a substitute for conversion.
