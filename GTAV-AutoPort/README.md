**2026-11-16 — PS4 texture and executable analysis expansion:** added bounded PE/ELF/PlayStation SELF header inspection so AutoPort can flag Windows PE files disguised as PRX/SPRX and ELF architecture mismatches without claiming that an x86-64 ELF is a valid Orbis plugin. Added an experimental DDS BC1/BC3/BC5 to PS4 Thin1DThin storage-layout stage with byte-for-byte untile round-trip checks; supported DDS files now produce partial storage candidates and JSON sidecars in the automatic prep ZIP. This is not a complete RSC7/YTD writer, and PS4-ready/installable counts remain zero. See [executable header inspection](docs/EXECUTABLE-HEADER-INSPECTION.md) and [PS4 texture storage adapter](docs/PS4-TEXTURE-STORAGE-ADAPTER.md).

**2026-11-15 — Confirmed GTA V target correction:** the active AutoPort profile, UI, automatic prep manifest, tests and deployment research now use the user's corrected target **CUSA00419 (US), GTA V update 1.57, GoldHEN 2.4b18.13**. Compatibility remains unverified until a matching resource/plugin is tested on that exact title/update.

**2026-11-15 — ORBX Engine package audit:** AutoPort now detects the ORBX PRX, INI, RPF archives and resource-tree layout in an imported package, reports duplicate/missing components, and records the expected `/data/orbx/orbx.ini` path without inventing configuration values or patching native binaries. The automatic prep bundle includes `reports/orbx-package-audit.json`. The audit also parses supplied INI/log bytes with strict size limits; encrypted archive payloads still need local extraction, and runtime compatibility remains unverified. See [ORBX package audit](docs/ORBX-PACKAGE-AUDIT.md).

**2026-11-15 — Writer-driven automatic preparation:** the prep ZIP now discovers conversion candidates from registered adapters instead of maintaining its own hardcoded resource-extension allowlist. The RageKit PC Legacy writer is registered as a format adapter; the general preparation flow invokes any registered conversion-capable adapter and preserves the strict PC-only compatibility boundary. See [Universal adapter registry](docs/UNIVERSAL-ADAPTER-REGISTRY.md).

**2026-11-15 — Signature-driven universal intake:** connected the adapter registry to the automatic file audit. It now probes binary content for RSC7, little-endian RPF7, DDS, PNG, WAV, Ogg, Windows PE and ELF signatures, and can infer broad file families when extensions are unknown. Extension classifications remain explicitly labeled as hints when content evidence is absent. See [Universal adapter registry](docs/UNIVERSAL-ADAPTER-REGISTRY.md).

**2026-11-15 — Evidence-based universal adapter registry:** added a data-driven adapter contract that identifies formats from bounded file evidence rather than mod names, sample filenames, creator-specific layouts or extension-only guesses. Equal-strength matches are reported as ambiguous; probe failures are isolated; unknown inputs remain preserved; conversion requires one unambiguous adapter with a real writer; and target compatibility defaults to unverified. See [Universal adapter registry](docs/UNIVERSAL-ADAPTER-REGISTRY.md).

**2026-11-14 — PS4 source-build guide assessment:** reviewed the community PS4 source-build guide supplied by the user. It describes a full ORBIS game/update rebuild targeting old firmware and GTA V 1.46, not a universal PC mod converter. Documented the mismatch with our CUSA00419 / firmware 14.00 / GTA V 1.57 target, extracted safe architecture lessons, and added provenance/security cautions. No proprietary source archive or third-party installer was downloaded or executed. See [PS4 source-build guide assessment](docs/PS4-SOURCE-BUILD-GUIDE-RESEARCH.md).

**2026-11-14 — Skyline DLC intake improvements:** fixed the workbench's incomplete-report guard so an invalid/null port-plan or native-engine summary cannot crash the results view or trigger an unsafe export. Added read-only parsing for GTA V DLC `content.xml` manifests, including declared resource paths and file types; manifest instructions are never executed. `.txt` and `.md` mod instructions are now classified as documentation instead of unknown binaries and routed to a readable review stage. See [DLC manifest inspection](docs/DLC-MANIFEST-INSPECTION.md).

**2026-11-14 — Native RPF integration test:** the RageKit CI job now creates a synthetic nested RPF archive, lists its nested entries with the real `rk` executable, and extracts a nested file through `rk rpf cat`. This exercises the actual upstream CLI behavior used by AutoPort rather than testing only a mocked response. See `scripts/rpf-cli-integration.mjs`.

**2026-11-14 — GoldHEN AFR deployment planning:** added a guarded overlay planner based on the official GoldHEN Application File Redirector documentation. It can generate a title-specific `plugins.ini` snippet and accepts only explicit `/app0/...` mappings; it rejects traversal and duplicate destinations. The staging plan is always review-only and deployment remains disabled until CUSA00419 / GTA V 1.57 paths and resource compatibility are validated. See [PS4 deployment research](docs/PS4-DEPLOYMENT-RESEARCH.md).

**2026-11-14 — Native RPF archive inventory:** the pinned RageKit CLI now uses its dedicated `rk rpf ls` reader for imported `.rpf` files, including nested archives. AutoPort validates every returned entry path, indexes file sizes/types, counts RAGE resources and encrypted entries, and displays a browsable inventory. For supported, unencrypted resources it uses the native `rk rpf cat` path to extract each entry into temporary local storage, then runs the resource parser and round-trip validator. This is source-side archive/resource inspection only; encrypted retail archives may require keys from the user's own game installation, and no PS4 compatibility or installability is inferred. Processing is bounded by per-command time/output limits, a three-minute archive inspection window, a 100-resource cap and an 80 MiB extracted-resource cap.

# GTAV AutoPort

**2026-11-15 — Multi-family conversion pipeline expansion:** added Menyoo/Spooner vehicle XML translation into a loss-preserving intermediate vehicle pack; expanded vehicle metadata mapping for audio, camera, handling and other fields; added a RageKit-backed PC Legacy YFT/YTD/YDR/YDD candidate writer with output inspection and round-trip verification; added source-level PC script behavior blueprints; and added ped/object metadata, asset and spawn-config mapping. These stages produce source-side interchange data and PC Legacy candidates only. PS4 CUSA00419 / 1.57 resource encoding, menu/runtime execution, Orbis PRX behavior and on-console acceptance remain explicit gates. See:
- [Menyoo vehicle translation](docs/MENYOO-VEHICLE-TRANSLATION.md)
- [Vehicle metadata mapping](docs/VEHICLE-METADATA-MAPPING.md)
- [YFT/YTD resource conversion](docs/YFT-YTD-RESOURCE-CONVERSION.md)
- [PC script native reimplementation](docs/PC-SCRIPT-NATIVE-REIMPLEMENTATION.md)
- [Portable native runtime core](docs/NATIVE-RUNTIME-CORE.md)
- [Ped/object pack mapping](docs/PED-OBJECT-PACK-MAPPING.md)


**2026-11-14 — Local 7z archive intake:** AutoPort now bundles the 7-Zip command-line binary for local extraction of `.7z` mods, including archives such as the Durango SRT test target. Extraction is performed by the local Vite workbench, inventories entries before extraction, rejects unsafe paths/links and encrypted entries, and enforces 160 MiB compressed / 512 MiB expanded / 5,000-file limits. No archive is uploaded to a remote service; this does not convert resources for PS4.

**2026-11-14 — OpenIV OIV intake:** AutoPort now opens `.oiv` packages directly using the ZIP container reader, detects and parses `assembly.xml`, extracts basic package metadata and inventories declared file operations for review. It does not execute OIV install instructions or assume PC install paths are valid on PS4.

**2026-11-14 — Guided workflow update:** the workbench now includes an in-app step-by-step porting guide, contextual next-step prompts, and first-run native-tool setup. `START-AUTOPORT.bat` installs web dependencies and attempts to fetch/build the pinned RageKit backend automatically when the local CMake/C++ toolchain is present. PS4 1.57 output remains unvalidated.

**2026-11-14 — Upstream integration audit:** RageKit v0.3.1 is already fetched and built as the primary native RAGE engine; the latest CI failure was traced to a malformed newline escape in the browser intake module and has been corrected. See [upstream integration register](docs/UPSTREAM-TOOL-INTEGRATION.md) for which external projects are wired in versus reference-only. PS4 1.57 output is still not validated.

**RPF archive validation added:** imported `.rpf` files now enter the native RAGE parser and isolated round-trip check alongside loose resources when the backend is configured. Encrypted archives may still require keys from the user's own game installation; this is validation only, not PS4 conversion.

**Universal intake audit added:** every imported ZIP/folder is now automatically classified by mod/resource family, with conservative binary-signature probes, PC-native plugin warnings, unknown-file preservation and family counts. This is an intake audit—not a claim that every identified file has a PS4 writer.

See [format research and backend selection](docs/FORMAT-RESEARCH.md) for evaluated open-source engines and PS4 compatibility gaps.


**Product direction: universal GTA V PC-to-PS4 Story Mode mod porting.** This is not a vehicle-only converter. Vehicles are the first inspected asset family; the long-term architecture covers peds, weapons, props, maps/world resources, textures, audio, animations, UI assets, configuration, scripts and native plugins, each with its own compatibility and adapter status. See [Universal mod-port architecture](docs/UNIVERSAL-MOD-PORT-ARCHITECTURE.md).

Universal intake does not mean every PC mod is automatically portable: Windows/ASI/DLL/ScriptHookV/.NET-dependent mods require a separate PS4-native implementation where feasible and must never be mislabeled as converted.


A separate, local-first project inside this repository for analyzing PC Grand Theft Auto V mods and preparing validated PlayStation 4 Story Mode conversions for GoldHEN.

> **Development status:** ZIP/OIV/7z/folder intake, vehicle metadata analysis, RSC7 inspection, automatic YFT/YTD inspection, and an optional ragekit native read/write round-trip backend are in the project. These are PC-side inspection and round-trip steps; no PS4 resource writer, exact-build validation, or installable package is claimed.

## Latest update

**2026-11-14 — Scaleform graphics intake:** AutoPort now detects and validates GFX/SWF headers, classifies font and ActionScript source files, routes them through a graphics-specific worklist, and can create a separate SWF editor-handoff copy for JPEXS. This is not a game-ready GFX build. The public PS4 GFX loader only proves a GTA V 1.46 fixed font hook; GTA V 1.57 runtime loading remains unvalidated. See [Scaleform graphics pipeline](docs/SCALEFORM-GRAPHICS-PIPELINE.md).

**2026-11-14 — PS4 GTA V GFX Loader research:** inspected the linked source code and confirmed a narrow GTA V 1.46 hook that redirects the `font_lib_efigs` request to a file under `/data`. It is a useful runtime-hook reference, not a universal graphics loader, and its hard-coded 1.46 address is not safe to reuse on GTA V 1.57. See [Project V and GFX loader research](docs/PROJECT-V-GOLDHEN-RESEARCH.md).

**2026-11-14 — Guided porting and first-run tool preparation**
- Added an in-app walkthrough with current-stage progress, contextual next-step prompts, and expandable setup/capability guidance.
- Updated the Windows launcher to attempt the pinned RageKit CMake FetchContent download/build when CMake and the compiler toolchain are available; it falls back to intake/planning when unavailable.
- Added native-engine executable auto-detection for standard build output paths, removing manual `GTAV_AUTOPORT_RK` setup in the normal launcher workflow.
- Kept all PS4 resource conversion and installation gates fail-closed.


**2026-11-13 — RPF archive validation added**
- Added `.rpf` archives to the native RAGE inspection queue, using the same isolated `rk info` and `rk roundtrip` workflow as supported loose resources.
- Extended the workbench's automatic native-resource selection so archive files are not silently skipped.
- Reports remain source-side parser/round-trip evidence only; encrypted archives may require user-owned game keys, and no PS4 output or install package is produced.

**2026-11-13 — GoldHEN target recorded**
- Recorded the user-confirmed PS4 system firmware `14.00` and GoldHEN `2.4b18.13` as separate target details; GTA V remains `CUSA00419` update `1.57` Story Mode.
- GoldHEN suffix is stored as user-confirmed; official release metadata independently confirms the `2.4b18` release family, not the `.13` suffix.
- Resource compatibility and deployment remain unverified.


**2026-11-13 — PS4 firmware target recorded**
- Recorded the user-confirmed PS4 system firmware 14.00 separately from the GTA V title update 1.57; GoldHEN version remains unknown and resource compatibility remains unverified.

**2026-11-13 — AutoPort JSX build repair**
- Corrected both missing/extra expression delimiters in the import-status JSX that blocked the Vite production build.
- Fixed an extra closing JSX brace in the native-inspection status area that prevented the Vite production build from compiling.
- Kept the native-engine and PS4 compatibility gates unchanged.

**2026-11-13 — Native backend CI coverage**
- Added a dedicated CI job to configure and compile the pinned ragekit CLI backend, so native integration build failures are caught rather than assumed away.


**2026-11-13 — Dependency graph regression alignment**
- Corrected a stale dependency-graph regression expectation: the graph also includes the explicitly resolved handling.meta dependency.


**2026-11-13 — Native ragekit resource-engine integration**
- Added a pinned CMake FetchContent build for MIT-licensed ragekit v0.3.1 and a Windows native-engine build helper.
- Added a local Vite endpoint that runs rk info and rk roundtrip for supported imported RAGE resources, hashes source/output bytes, and reports parse errors, byte-exact round trips, and successful rewrites whose output bytes differ.
- Added automatic workbench invocation and downloadable native validation reports when the native engine is configured.
- Added explicit fail-closed behavior when the engine executable is not configured; no source resources are labeled converted and PS4 compatibility remains unestablished.
- This is PC resource parsing/rewrite validation, not a PS4 writer or install package.


**2026-11-13 — Universal resource-family port planning**
- Added a per-file conversion work plan for archives, fragments, drawables, textures, collision, maps, archetypes, animation, particles, audio, metadata, scripts, plugins and source assets.
- Each route exposes source-side capability, target-side adapter gap, work stage and a concrete blocker; PC plugins/scripts are routed to native behavior reimplementation rather than payload copying.
- Added cautious same-basename candidate relationships, clearly marked as unverified, and per-stage pipeline queues.
- The workbench now creates and displays this plan automatically on import and allows it to be exported as JSON. This remains planning only; no resource writer or PS4 package is claimed.


**2026-11-13 — Automatic native inspection on import**
- Added a local Vite development-server endpoint that invokes the Rust read-only inspector for every imported YFT/YTD asset.
- The workbench now automatically loads generated YFT structural reports, YTD metadata, and PNG texture previews after ZIP/folder import; manual report-folder import is no longer part of the normal workflow.
- Source resources are processed in a temporary local directory and removed after report data is returned. This requires the Rust stable toolchain and Cargo; no mod data is uploaded.
- Automatic native inspection is a local development workflow; a packaged desktop runtime is still needed for a production-grade end-user installer.


**2026-11-13 — Evidence-based PS4 compatibility gates**
- Added an explicit seven-gate compatibility assessment covering console identity, GoldHEN, PS4 YFT/YTD reference resources, conversion adapters, and deployment/rollback validation.
- Added a dashboard checklist showing pending evidence and keeping conversion/deployment disabled even if evidence flags are supplied until real writer and validation workflows exist.
- Added regression tests for blocked defaults, incomplete evidence, and fail-closed behavior.

**2026-11-13 — Native report test assertion aligned**
- Updated the duplicate-report regression test to assert the specific duplicate-generic-report error emitted by the report loader; runtime behavior is unchanged.

**2026-11-13 — First PS4 target profile recorded**
- Recorded the user-confirmed target label `CUSA00419` / GTA V `1.57` / PS4 Story Mode in a dedicated target profile module.
- The target profile is included in exported conversion manifests and shown in the workbench.
- Added regression tests to ensure the supplied target label remains stable and explicitly unverified.
- This records the intended target only; it does not independently verify the console build or establish YFT/YTD compatibility.


**2026-11-13 — Native inspection reports connected to the workbench**
- Added a dedicated **Load native reports** folder import to the dashboard.
- Added Windows launchers: `START-AUTOPORT.bat` starts the local workbench; `RUN-NATIVE-INSPECTOR.bat` opens file pickers and inspects multiple YFT LOD files plus the matching YTD in one report set.
- Dashboard now reads YFT JSON structural summaries and displays model, geometry, triangle, bone-transform, and physics-child counts.
- Dashboard now loads YTD JSON and shows PNG texture previews with dimensions, formats, and mip levels.
- Preview object URLs are released when reports are replaced or the UI unmounts.
- Added report schema validation, safe relative preview matching, PNG signature checks, and tests for malformed or unsafe report content.
- Added a manual `workflow_dispatch` trigger for the isolated GitHub Actions checks.

**2026-11-13 — Native YFT/YTD inspection foundation**
- Added a Rust CLI adapter using the public-domain `rage-formats` crate.
- YFT reports can include fragment, drawable, LOD, geometry, triangle, bone-pose, and physics-child summaries.
- YTD inspection exports DDS files plus PNG previews where decoding succeeds, and records dimensions, pixel format, mip levels, and names.
- Added extracted-folder import to the browser workbench.
- Added RSC7 header fields and sample-version comparison based only on the supplied Glendale PC fixture.
- Added a repository-root GitHub Actions workflow with independent JavaScript test/build and Rust test/build jobs.
- PS4 conversion and deployment remain blocked pending a verified PS4-target writer and exact-build console tests.

See [CHANGELOG](CHANGELOG.md) for every update.

## Universal conversion architecture

The workspace now discovers vehicle model names from imported `vehicles.meta` rather than defaulting to the Glendale fixture, and builds an initial generic inventory/dependency graph for resource types and explicit model/texture/handling references. This graph clearly marks missing and ambiguous matches; full DLC/archive relationship resolution remains unfinished.

The converter is being designed around a vehicle-agnostic intermediate representation and target-specific adapters. The first Glendale vehicle is a regression fixture only; no model name, handling ID, texture name, or fixed asset count is a conversion assumption. See [Universal vehicle port architecture](docs/UNIVERSAL-PORT-ARCHITECTURE.md) for the dependency graph, geometry/fragment/material/texture/collision IR, adapter contract, round-trip validation and exact-target evidence requirements. The current PC YFT/YTD inspector is read-only; PS4 writers and a verified PS4 fixture set are not yet implemented.

## Scope
- Input: PC GTA V mods.
- Target: PS4 Story Mode only. No GTA Online.
- Outputs: organized loose files and, after all compatibility checks pass, a PS4 deployment package.
- Local-first processing; no cloud workspace or user mod storage.

## First test target
A PC replacement for the existing `glendale` vehicle containing `glendale.yft`, `glendale_hi.yft`, `glendale.ytd`, `vehicles.meta`, and `handling.meta`.

## Project structure
- `src/` — browser workbench and JavaScript conversion pipeline.
- `native-inspector/` — Rust read-only YFT/YTD inspection adapter.
- `docs/` — architecture, format research, target compatibility, and roadmap.
- `tests/` — metadata, archive intake, and RSC7 header tests.
- `.github/workflows/gtav-autoport.yml` — isolated CI checks for this project folder.

## Run the workbench
Requirements: Node.js 20 or newer.

On Windows, double-click `START-AUTOPORT.bat`. It checks Node.js, installs dependencies (including the bundled 7-Zip executable) on first launch, and starts the local workbench. Keep the terminal window open while using the app. The `.7z` extraction endpoint is provided by this local development server; a static hosted build alone cannot run native archive extraction.

    npm install
    npm run dev
    npm test
    npm run build

## Build the native RAGE resource engine

Requirements: Git, CMake 3.20+, and Visual Studio 2022 C++ Build Tools (C++20). Run BUILD-NATIVE-ENGINE.bat or use the commands in [native-engine/README.md](native-engine/README.md). Set GTAV_AUTOPORT_RK to the built rk.exe path before starting Vite. The workbench automatically runs the native parser and round-trip writer on supported imported RAGE resource types and offers a JSON validation report. This tests the PC-side parser/writer only; it does not make PS4 output.

## Run the native inspector
Requirements: Rust stable toolchain.

    cd native-inspector
    cargo test
    cargo build --release
    cargo run --release -- path/to/glendale.yft
    cargo run --release -- path/to/glendale.ytd

The native adapter parses resources and exports YTD textures to DDS/PNG for inspection. Optional fixture tests accept `GTAV_AUTOPORT_YFT` and `GTAV_AUTOPORT_YTD` paths so the supplied mod can be tested locally without committing its binaries. It does not rewrite YFT or create a PS4 package.

## Run the native inspector and load its reports

Build the native adapter once:

    cd native-inspector
    cargo build --release

For the supplied Glendale vehicle pair, run both commands from the same parent directory. Because the files share the `glendale` basename, both reports are written into the same `glendale-autoport-inspection` output folder:

    cargo run --release -- /path/to/glendale.yft
    cargo run --release -- /path/to/glendale.ytd

Then open the AutoPort workbench and choose **Load native reports**. Select the `glendale-autoport-inspection` folder. The dashboard validates the JSON report schema, displays separate metrics for each selected YFT (including `glendale_hi.yft`), and shows YTD PNG previews when the native decoder generated them.

## Safety
Never overwrite original game files. Never label copied PC assets as converted. A deployment package is only installable after conversion, dependency validation, and testing against the exact PS4 title ID and game build.


**2026-11-15 — US target profile correction:** the user confirmed their own base-game PKG is **CUSA00419 (US)**. AutoPort's active target profile now records CUSA00419, publisher prefix UP1004 and content ID UP1004-CUSA00419_00-GTAVDIGITALDOWNL. The prior CUSA00411 / 01.57 community backend is retained only as a separate research reference; its binaries, offsets and templates are not treated as compatible with this US target. The reported 1.57 target remains unverified against a fresh PKG metadata report and console state.


**2026-11-15 — Native RPF7 writer foundation and Orbis executable analysis:** added a pure-JavaScript writer for standard PC RPF7 OPEN archives, including directory/file TOC construction, 512-byte payload alignment, path/collision checks and safe refusal of RSC7 resources without page flags. Separately inspected the supplied Orbis builder executable's registered Lua API and its 30 KB output sample. The sample uses a nonstandard fourth header word and encrypted TOC/name data, so the PC OPEN writer is explicitly not presented as an Orbis writer. See [native RPF7 writer](docs/NATIVE-RPF7-WRITER.md) and [Orbis executable capability analysis](docs/ORBIS-EXECUTABLE-CAPABILITY-ANALYSIS.md).

**2026-11-15 — One-click automatic preparation bundle:** after importing a mod, users can build one ZIP that preserves every original file, automatically converts all eligible YFT/YDR/YDD/YTD resources through the configured RageKit PC Legacy writer, and includes per-file results plus a manifest. Failed conversions remain reported and originals are never overwritten. This is a PC Legacy preparation bundle, not a PS4 install package; the CUSA00419 / GTA V 1.57 writer remains unverified. See [Automatic preparation bundle](docs/AUTOMATIC-PREP-BUNDLE.md).

**2026-11-15 — Orbis RPF Builder recipe integration:** added a tested generator for the Lua build script and Windows launcher demonstrated by the user-supplied Orbis RPF Builder example. It validates archive-relative paths, rejects traversal and duplicate destinations, and explicitly keeps PS4 1.57 compatibility and installability unverified. Third-party EXE/DLLs are not bundled because the supplied ZIP contained no license file. See [Orbis RPF Builder integration](docs/ORBIS-RPF-BUILDER-INTEGRATION.md).


**2026-11-15 — Automatic dependency graph:** every preparation bundle now includes a read-only dependency report that resolves quoted file references against the imported package and explicitly flags missing or ambiguous targets. The scan is bounded, does not execute scripts or metadata, and makes no mod-specific naming/layout assumptions. See [Automatic dependency graph](docs/AUTOMATIC-DEPENDENCY-GRAPH.md).


**2026-11-15 — Safer archive and dependency intake:** the RPF7 OPEN inspector now rejects cyclic directory-parent relationships instead of returning a malformed hierarchy. Mod intake now handles Windows-style paths consistently and warns when a recognized binary signature conflicts with the filename extension. Dependency scanning also supports BOM-marked UTF-16 metadata commonly exported by Windows tools.
