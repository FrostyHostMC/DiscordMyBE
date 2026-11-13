# GTAV AutoPort

A separate, local-first project inside this repository for analyzing PC Grand Theft Auto V mods and preparing validated PlayStation 4 Story Mode conversions for GoldHEN.

> **Development status:** ZIP/folder intake, vehicle metadata analysis, RSC7 header inspection, and a native read-only YFT/YTD parser adapter are now in the project. None of these steps converts a PC vehicle to PS4. Review reports and extracted DDS textures are not installable packages.

## Latest update

**2026-11-13 — Native YFT/YTD inspection foundation**
- Added a Rust CLI adapter using the public-domain `rage-formats` crate.
- YFT reports can include fragment, drawable, LOD, geometry, triangle, bone-pose, and physics-child summaries.
- YTD inspection exports DDS files plus PNG previews where decoding succeeds, and records dimensions, pixel format, mip levels, and names.
- Added extracted-folder import to the browser workbench.
- Added RSC7 header fields and sample-version comparison based only on the supplied Glendale PC fixture.
- Added GitHub Actions checks for JavaScript tests/build and Rust tests/build.
- PS4 conversion and deployment remain blocked pending a verified PS4-target writer and exact-build console tests.

See [CHANGELOG](CHANGELOG.md) for every update.

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

The native adapter currently parses resources and exports YTD textures to DDS for inspection. It does not rewrite YFT or create a PS4 package.

## Safety
Never overwrite original game files. Never label copied PC assets as converted. A deployment package is only installable after conversion, dependency validation, and testing against the exact PS4 title ID and game build.
