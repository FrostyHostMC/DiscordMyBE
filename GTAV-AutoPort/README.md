# GTAV AutoPort

A separate, local-first project inside this repository for analyzing PC Grand Theft Auto V mods and preparing validated PlayStation 4 Story Mode conversions for GoldHEN.

> **Early development:** This folder is isolated from AutoBE. It does not modify, import, or depend on AutoBE source code. The first milestone is a metadata-aware importer for a Glendale replacement vehicle. PC YFT/YTD assets are not yet converted to PS4 format, so generated review outputs must not be installed.

## Scope
- Input: PC GTA V mods.
- Target: PS4 Story Mode only. No GTA Online.
- Outputs: organized loose files and, after all compatibility checks pass, a PS4 deployment package.
- Local-first processing; no cloud workspace or user mod storage.

## First test target
A PC replacement for the existing `glendale` vehicle containing `glendale.yft`, `glendale_hi.yft`, `glendale.ytd`, `vehicles.meta`, and `handling.meta`.

## Project structure
- `src/` — application and conversion pipeline.
- `docs/` — architecture, format research, target compatibility, and roadmap.
- `tests/` — safe metadata parsing and manifest tests.

See [Architecture](docs/ARCHITECTURE.md), [Roadmap](docs/ROADMAP.md), and [PS4/GoldHEN notes](docs/PS4-GOLDHEN.md).

**Safety:** never overwrite original game files. Never label copied PC assets as converted. A deployment package is only installable after conversion, dependency validation, and testing against the exact PS4 title ID and game build.
