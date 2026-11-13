# GTAV AutoPort

A separate, local-first project inside this repository for analyzing PC Grand Theft Auto V mods and preparing validated PlayStation 4 Story Mode conversions for GoldHEN.

> **Development status:** ZIP/folder intake, vehicle metadata analysis, RSC7 header inspection, and a native read-only YFT/YTD parser adapter are now in the project. None of these steps converts a PC vehicle to PS4. Review reports and extracted DDS textures are not installable packages.

## Latest update

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
- Recorded the user-confirmed target label `CUSA00411` / GTA V `1.73` / PS4 Story Mode in a dedicated target profile module.
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

On Windows, double-click `START-AUTOPORT.bat`. It checks Node.js, installs dependencies on first launch, and starts the local workbench. Keep the terminal window open while using the app.

    npm install
    npm run dev
    npm test
    npm run build

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
