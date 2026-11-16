# Project V PS4 Manager

**Single-package rule:** the deliverable is one installable homebrew PKG named **Project V PS4 Manager**. The build must not emit separate manager, library, configuration, or runtime-component PKGs. All manager executable code, UI assets, metadata, and any approved bundled support files are staged into one GP4 and built into the single Content ID below. If an optional component is distributed as a separate archive, its files must be inspected and integrated into this package's payload—not delivered as a second installer.


The controller-driven PS4 homebrew companion for GTA V mod intake and Project V profile management. It browses USB 0, USB 1, `/data`, the Project V import library at `/data/ProjectV/imports`, and the legacy AutoPort staging folder for migration. It inventories supported GTA V resource/configuration files and copies selected files into the import library using a temporary `.part` file, byte-count verification, flush, atomic rename, collision-safe names and JSONL import receipts. The original source files and GTA V game files are never modified.

## Package identity

- Display name: Project V PS4 Manager
- Title ID: `AUPT00001`
- Content ID: `IV0000-AUPT00001_00-AUTOPORTPS400000`
- Package: unsigned OpenOrbis homebrew PKG
- Toolchain: OpenOrbis PS4 Toolchain v0.5.4 (LLVM 18)
- Build artifact: `AutoPort-PS4-PKG` in the GitHub Actions run

## Compatibility profiles

The profile selector keeps four GTA V title/update combinations separate:

- GTA V 1.57 US — `CUSA00419` (primary development target)
- GTA V 1.57 EU — `CUSA00411`
- GTA V 1.56 US — `CUSA00419` (community profile)
- GTA V 1.56 EU — `CUSA00411` (community profile)

Every profile currently reports unverified. Selecting a profile does not enable runtime hooks. Hook activation remains blocked until an exact matching executable fingerprint, unique hook signatures, and runtime validation are recorded.

## Single-PKG contents and Project V reuse

The package is deliberately a single installer. The GP4 manifest gathers the manager EBOOT, SFO metadata, application icon, and files under `sce_sys/about`, `sce_module`, and `assets` into one PKG. No second install prompt should be required for the manager's own components.

Project V compatibility is a reuse-first requirement: existing PS4-ready Project V resources and supported mod formats should be preserved and integrated where their exact files and licenses permit. AutoPort should only implement conversions or runtime support that Project V does not already provide. The Project V v1.2 PRX/archive is not currently present in this source tree, so this build must not claim that PRX or its original mod payload is bundled. When the archive is available to the build, its contents must be audited and only compatible payload files added to this same GP4/PKG; do not wrap an existing installable PKG inside another PKG and call it merged.

## Current app boundary

This PKG is the PS4-side staging and library companion. It does not convert PC YFT/YTD/YDR resources, unpack ZIP/7z/OIV archives on-console, install a Project V PRX, deploy AFR overlays, or modify `plugins.ini` automatically. Those actions remain separate gated features; the app must not imply they are complete.

## Build

The repository's `.github/workflows/gtav-autoport.yml` workflow builds the EBOOT and PKG with the pinned OpenOrbis v0.5.4 toolchain, validates the resulting package with `PkgTool.Core pkg_validate`, and uploads the PKG, EBOOT and SHA-256 manifest as the `AutoPort-PS4-PKG` artifact. The PKG is unsigned homebrew and requires a compatible jailbroken PS4/GoldHEN environment. Physical-console installation and runtime behavior are not represented as verified until tested on hardware.
