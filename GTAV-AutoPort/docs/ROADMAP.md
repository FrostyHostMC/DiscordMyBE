# AutoPort roadmap

## Active target

- User-confirmed console: PS4 with GoldHEN.
- User-confirmed game target: Grand Theft Auto V, US title ID CUSA00419, update 1.57, Story Mode.
- Target identity is recorded, not independently re-verified. Resource compatibility, plugin offsets, archive destinations and console installability remain unverified.
- GTA Online is out of scope.

## Current capability snapshot

- [x] Local-first React/Vite workbench and ZIP/folder intake.
- [x] Preserve imported originals and reject unsafe paths, symlinks, duplicate archive paths and oversized inputs.
- [x] Inventory/classify broad GTA V mod families and retain unknown files.
- [x] Build dependency and candidate-relationship reports with ambiguity/missing-reference handling.
- [x] Inspect supported PC RPF7 OPEN archives recursively with bounded depth, archive count, file count, expanded bytes and path lengths.
- [x] Keep encrypted/unsupported RPF variants unchanged rather than guessing at their structure.
- [x] Run RageKit PC Legacy resource candidates through a round-trip gate; label outputs PC Legacy only.
- [x] Generate per-file PS4 delivery plans and automatic preparation ZIP reports.
- [x] Audit ORBX package components, inspect supplied orbx.prx PE/ELF/SELF headers, parse supplied INI bytes and extract bounded diagnostic excerpts from supplied runtime logs.
- [x] Inspect PE, ELF, PlayStation SELF and Sony SCE executable signatures; report architecture clues without claiming Orbis compatibility.\n- [x] Record bounded SHA-256 provenance for original files, extracted RPF entries and generated texture candidates.
- [x] Prototype DDS BC1/BC3/BC5 conversion into PS4 Thin1DThin texture storage with byte-for-byte untile round-trip tests.
- [x] Build explicit GoldHEN AFR overlay plans for already-built PS4 RPFs when the user supplies exact mappings and attestations.
- [ ] Complete an end-to-end PS4 RSC7/YTD texture dictionary writer and verify it against CUSA00419 retail fixtures.
- [ ] Integrate a real Orbis RPF writer into the local pipeline and validate its output independently.
- [ ] Validate a supported PS4 runtime/loader path for CUSA00419 / 1.57.
- [ ] Produce a reversible, installable Story Mode package only after all target gates pass.

## Phase 1 — intake and source analysis

- [x] ZIP and extracted-folder intake.
- [x] Safe relative path normalization and archive extraction limits.
- [x] File-family classification and conservative binary signature detection.
- [x] Vehicle and handling metadata parsing, model/texture candidate mapping and conversion manifest.
- [x] Recursive supported PC RPF7 OPEN extraction with provenance.
- [ ] Deep DLC metadata and load-order resolution.
- [ ] Expand dependency graph across variations, carcols, mod kits, audio, layouts, collision, LOD and damage resources.
- [ ] Add archive duplicate-content detection by hash, not just path.

## Phase 2 — binary and resource inspection

- [x] RSC7 signature and basic resource inspection.
- [x] Native Rust YFT fragment and YTD texture dictionary read-only parser.
- [x] YFT drawable/LOD/geometry/triangle and physics-child reports.
- [x] YTD texture metadata and DDS inspection export.
- [x] Executable header inspection for PE, ELF and SCE containers.
- [x] DDS BC1/BC3/BC5 PS4 texture storage prototype with generated-fixture round trips.
- [ ] Inspect and validate RSC7 page flags, resource boundaries and pointer graphs independently.
- [ ] Inspect shader/material references and external texture dictionary dependencies.
- [ ] Add real retail fixture integration tests for CUSA00419 1.57 (fixture hashes and provenance required).
- [ ] Validate PS4 Thin1DThin swizzle against known-good CUSA00419 texture bytes and console rendering.

## Phase 3 — universal intermediate representation

- [x] Define vehicle-agnostic conversion architecture and versioned adapter registry.
- [x] Keep unknown/ambiguous files preserved and conversion authorization separate from recognition.
- [ ] Add typed, versioned platform-neutral resource IR for geometry, skeletons, materials, textures, collision, metadata and audio.
- [ ] Implement source decoders that preserve unsupported constructs and report lossy fields explicitly.
- [ ] Implement deterministic dependency graph IDs and hash-based provenance for every resource.
- [ ] Add independent fixture corpus and adapter conformance tests.

## Phase 4 — PS4 resource conversion

- [x] Implement experimental BC1/BC3/BC5 block tiling for PS4 Thin1DThin storage payloads only.
- [ ] Build complete PS4 RSC7/YTD texture dictionary serialization, including texture objects, mip views, names and resource-page layout.
- [ ] Implement PS4 YFT/YDR/YDD/YBN adapters from verified source decoders and exact-build reference templates.
- [ ] Implement PS4 map/archetype/metadata adapters with schema-aware translation (never extension-only renaming).
- [ ] Implement audio conversion only after format-specific decoding, encoding and game reference validation.
- [ ] Validate each writer by independent readback, hashes, structural invariants and target game tests.
- [ ] Do not mark any resource PS4-ready based solely on PC Legacy round-trip or a storage-payload round-trip.

## Phase 5 — archive and package delivery

- [x] Plan per-file delivery routes and report explicit blockers.
- [x] Generate AFR staging packages for complete, already-built PS4 RPFs only, with explicit mappings, SHA-256 and required user attestations.
- [x] Generate Orbis RPF build recipes as a separate script-generation helper.
- [ ] Integrate a supported Orbis RPF writer runtime with capability checks, sandboxed execution, timeouts and output readback.
- [ ] Add target-specific RPF path mapping from verified retail game references.
- [ ] Produce a reversible deployment package with backups and rollback instructions.
- [ ] Keep install/deploy disabled until exact CUSA00419 1.57 tests pass.

## Phase 6 — runtime-dependent PC mods

- [x] Identify PC ASI/DLL/EXE and distinguish them from PS4-native module signatures.
- [x] Define an abstract portable native behavior blueprint/runtime core.
- [ ] Build a minimal PS4-native GoldHEN runtime using a supported Orbis toolchain.
- [ ] Add fail-closed title/build identity checks and safe disable/logging.
- [ ] Reimplement selected PC mod behaviors through documented, tested native feature adapters.
- [ ] Never execute untrusted mod scripts or load PC binaries on PS4.

## Next high-value implementation order

1. Finish and independently validate the PS4 texture dictionary writer using the existing BC storage prototype.
2. Integrate a real Orbis RPF builder behind a sandboxed adapter and validate its output.
3. Add a hash-addressed resource graph and exact target fixture manifest.
4. Select one low-risk resource family (texture replacement) for an end-to-end CUSA00419 1.57 test.
5. Only then expand to models, vehicles, peds, maps, scripts and runtime plugins.

## Non-goals and hard rules

- No GTA Online support.
- No claiming universal conversion for arbitrary mods.
- No renaming YMT to OMT or relabeling PC RPF/YFT/YTD files as PS4.
- No bundling proprietary SDKs, game assets, unlicensed tools or third-party binaries.
- No generated PRX or console installation claim without a reproducible Orbis build and on-console validation.
