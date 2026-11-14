# PS4 GTA V source-build guide: applicability assessment

Reference reviewed: [FranklinClintonDev/gta-v-source-code-guide — PS4.md](https://github.com/FranklinClintonDev/gta-v-source-code-guide/blob/main/PS4.md)

## What this guide is about

This is a community guide to rebuilding a full PS4 GTA V game/update image from a matching PS4 source tree. It describes the ORBIS target in Visual Studio, building the game executable (ELF), shaders and single-player scripts, then rebuilding an update PKG. It is not a ready-made PC-mod-to-PS4 converter and does not document a general-purpose import pipeline for third-party vehicle DLC.

## Hard version mismatch with our target

The guide explicitly calls for:
- PS4 firmware around 9.00–11.00, with 12.00 described as not recommended.
- An update RPF / update package at GTA V version 1.46.
- ORBIS SDK 1.200 / 2.500 and a legacy Visual Studio 2017 toolchain.

The AutoPort target profile supplied by the user is PS4 firmware 14.00, GoldHEN 2.4b18.13, title ID CUSA00411, GTA V update 1.73, Story Mode. The guide does not establish compatibility with firmware 14.00 or update 1.73. Do not use its old update package, replace the user's 1.73 installation with 1.46, or follow its full rebuild instructions as an installation procedure for this target.

## What we can safely learn for AutoPort

1. **PS4 build outputs are platform-specific.** The guide distinguishes the ORBIS game executable, PS4 shader output and PS4 script output. That supports keeping platform-specific adapters and validation separate from PC resource inspection.
2. **The game/update package is a coordinated set.** Executable, shaders, scripts, game configuration and RPF content are assembled into a rebuilt update image. A single PC asset file cannot be assumed installable merely because a parser recognizes it.
3. **The RPF container matters.** The guide's patch process places the base game's `common.rpf` into the rebuilt image and applies update content. AutoPort must reason about the target archive/container path and version, not just the internal PC DLC path.
4. **Source build and asset porting are different jobs.** Rebuilding the whole game requires the matching source tree, platform SDK, build environment and package pipeline. AutoPort's near-term objective remains converting/modifying compatible user-owned game assets and building a reversible deployment overlay—not rebuilding Rockstar's entire game executable.
5. **The guide is not a target-build reference for 1.73.** Any future use of its technical details must be revalidated against the user's exact game build and legally obtained development materials.

## Security and provenance cautions

The guide recommends disabling antivirus and references third-party installers, old SDKs and a password-protected source archive. AutoPort must not automate disabling security software, execute opaque installers, or download/extract unverified source-code bundles. The guide's existence does not establish the provenance or redistribution rights of the referenced proprietary game source. Use only legitimately obtained tools and user-owned game files; keep all mod/archive inspection read-only and sandboxed.

## Required evidence before any PS4 writer is enabled

- Exact CUSA00411 update 1.73 reference RPFs/resources from the user's own installation, with hashes and source paths.
- Resource/container metadata demonstrating the PS4 platform variant and version—not merely an RSC7 signature or a user-entered target label.
- A known-good PS4 1.73 resource/container that can be parsed and rebuilt without changing semantics, then compared/validated.
- A reversible packaging/overlay plan and explicit console-side validation.

Until these exist, keep PS4 resource writers and deployment locked. Continue with source archive inventory, manifest parsing, PC resource classification, documentation extraction and read-only diagnostics.
