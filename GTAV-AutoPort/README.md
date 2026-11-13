# GTAV AutoPort

A separate, local-first project inside this repository for analyzing PC Grand Theft Auto V mods and preparing validated PlayStation 4 Story Mode conversions for GoldHEN.

> **Development status:** ZIP intake and first-pass vehicle metadata analysis are implemented. PC YFT/YTD assets are not yet converted to PS4 format. Review reports and manifests are not installable packages.

## Latest update

**2026-11-13 — ZIP intake + Glendale metadata analysis**
- Import a ZIP mod locally and inspect its file inventory.
- Reject unsafe archive paths, duplicate paths, symlinks, and oversized archives.
- Parse vehicles.meta and handling.meta, select one vehicle, and resolve its handling reference.
- Check expected YFT/YTD filenames and report RSC7 signatures.
- Export a SHA-256 conversion manifest.
- Deployment remains locked until real PS4 asset conversion and exact-build validation exist.

See [CHANGELOG](CHANGELOG.md) for every update.

## Scope
- Input: PC GTA V mods.
- Target: PS4 Story Mode only. No GTA Online.
- Outputs: organized loose files and, after all compatibility checks pass, a PS4 deployment package.
- Local-first processing; no cloud workspace or user mod storage.

## First test target
A PC replacement for the existing glendale vehicle containing glendale.yft, glendale_hi.yft, glendale.ytd, vehicles.meta, and handling.meta.

## Project structure
- src/ — application and conversion pipeline.
- docs/ — architecture, format research, target compatibility, and roadmap.
- tests/ — metadata and archive intake tests.

## Run locally
Requirements: Node.js 20 or newer.

    npm install
    npm run dev
    npm test
    npm run build

## Safety
Never overwrite original game files. Never label copied PC assets as converted. A deployment package is only installable after conversion, dependency validation, and testing against the exact PS4 title ID and game build.
