# Project V PS4 Version and Firmware Compatibility Audit

## Correct target definition

The primary target is the user's installed **GTA V PS4 title update 1.57**, on **PS4 system software 14.00**.

These are separate compatibility dimensions:
- **GTA V 1.57** identifies the game update and executable / memory layout that Project V must hook.
- **PS4 system software 14.00** identifies the console OS environment and affects homebrew toolchain, loader and GoldHEN compatibility.
- **GoldHEN version and plugin-loading support** are a third, separately verified requirement.
- **CUSA title ID** identifies the regional game release. US and EU evidence must remain separate.

The first implementation target is 1.57 US (`CUSA00419`). The EU title ID (`CUSA00411`) remains separate. GTA V 1.56 is retained as a secondary community compatibility target; it must never share 1.57 offsets or fingerprints.

## 1.46 research note

A public GTA V PS4 source-build guide explicitly instructs users to update its source RPF to v1.46. This is evidence that a separate PS4 source-build project used 1.46, **not evidence that the Project V plugin PRX was built for 1.46**. Project V's exact v1.2 archive and PRX are not currently in this repository, so the claim that Project V itself targets 1.46 remains unverified until its own metadata/source or original binary is inspected.

Reference: https://github.com/FranklinClintonDev/gta-v-source-code-guide/blob/main/PS4.md

## Source inspected

Public Project V 1.3.2 source: https://github.com/rfoodxmodz/GTAV-ProjectV-1.3.2

Files inspected: `source/main.cpp`, `source/hooks.cpp`, `source/utility.cpp`, `include/hooks.h`, `include/gfx_list.h`, and `Makefile`.

The public source is not proof that the user's v1.2 PRX is identical. Preserve the v1.2 archive and PRX until a byte-level and source-level comparison is possible.

## High-risk defects found in public 1.3.2 source

1. **Uninitialized hook address.** `my_thread()` declares `u64 dlc_gxt2_addr;` and tests it before assigning it.
2. **Unchecked pattern scans.** Several scan results are passed to memory-copy and detour functions without confirming a unique valid match.
3. **Unsafe derived addresses.** Some scan results are adjusted backwards (including `- 0x60` and `- 0xC`) before checking bounds and expected instruction bytes.
4. **Version-sensitive scan windows.** Hard-coded address ranges and patterns are not evidence for GTA V 1.57 on PS4.
5. **No all-hooks preflight.** Resolve and validate every required hook first; if any required hook is missing, ambiguous or mismatched, install none.
6. **Build metadata mismatch.** `PLUGIN_VER` is `0x130` while its adjacent comment says `1.10`.
7. **Makefile variable typo.** `COMMON_DIR` is declared but `COMMONFILES` expands `COMMONDIR`.
8. **Toolchain include-path risk.** The C++ standard library include path appears to be assembled using the project's include directory; verify against the actual OpenOrbis toolchain.

## Required validation matrix

| Game update | Region | Title ID | Console firmware target | Status |
|---|---|---|---|---|
| 1.57 | US | CUSA00419 | 14.00 (primary user environment) | Unverified |
| 1.57 | EU | CUSA00411 | Record independently | Unverified |
| 1.56 | US | CUSA00419 | Record independently | Unverified |
| 1.56 | EU | CUSA00411 | Record independently | Unverified |

Firmware 14.00 must not be written into the game-version field or treated as proof of GoldHEN plugin compatibility. Confirm the exact GoldHEN release and plugin loader behavior for this firmware independently.

## 1.57 adaptation plan

1. Preserve and inspect the exact ProjectV v1.2 archive and PRX.
2. Identify the exact PS4 GTA V 1.57 title ID and installed executable build from the user's own metadata.
3. Obtain a legally supplied matching executable reference and record SHA-256, size and ELF/module metadata.
4. Resolve every Project V hook against that exact 1.57 executable; record match count, address, expected bytes and scan window.
5. Require exactly one match for every required signature. Reject zero or multiple matches.
6. Validate instruction boundaries and complete patch windows before any detour is installed.
7. Add fixtures for missing/ambiguous signatures, truncated images, negative offsets, invalid prologues and all-or-nothing hook preflight.
8. Keep 1.56 separate as a secondary target. Never reuse its offsets for 1.57.
9. Only label the PRX compatible after a matching build and runtime validation. No console validation is claimed here.

## Current project state

The PS4 manager lists 1.57 first and 1.56 second. All profiles remain unverified and runtime hooks remain locked. Selecting a profile does not patch GTA V.

## Sources

- Rockstar GTA V 1.56 PS4 update notes: https://support.rockstargames.com/articles/19RzVUJUXvOHqS9uSksYDt/gtav-title-update-1-56-notes-ps4-ps5-xbox-one-xbox-series-x-s
- GTA V PS4 source-build guide (1.46 reference only): https://github.com/FranklinClintonDev/gta-v-source-code-guide/blob/main/PS4.md
- Project V 1.3.2 source: https://github.com/rfoodxmodz/GTAV-ProjectV-1.3.2
- GoldHEN plugin repository: https://github.com/GoldHEN/GoldHEN_Plugins_Repository