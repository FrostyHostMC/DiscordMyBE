# Project V 1.73 Compatibility and Source Audit

## Target scope

This project now tracks four independent profile combinations:

| GTA V build | Region | PS4 title ID | Evidence state |
|---|---|---|---|
| 1.57 | US | CUSA00419 | Unverified |
| 1.57 | EU | CUSA00411 | Unverified |
| 1.73 | US | CUSA00419 | Unverified |
| 1.73 | EU | CUSA00411 | Unverified |

The title IDs are carried forward from the existing project target configuration. The 1.73 profile is a separate build profile, not a claim that a 1.57 executable or hook signature works on 1.73.

Rockstar's official Title Update 1.73 notes list PS4 among the supported platforms. This confirms that 1.73 is a PS4 title-update target. It does not publish executable hashes, code offsets, or Project V compatibility evidence.

## Source inspected

The public Project V 1.3.2 source tree was inspected statically:
- https://github.com/rfoodxmodz/GTAV-ProjectV-1.3.2
- Files: `source/main.cpp`, `source/hooks.cpp`, `source/utility.cpp`, `include/hooks.h`, `include/gfx_list.h`, and `Makefile`.

The user's earlier ProjectV_Plugin_v1.2.zip is a separate packaged release. Its archive bytes and PRX are not currently available in this repository, so the v1.3.2 source cannot be assumed to be a byte-for-byte or behavior-identical replacement for v1.2.

## High-risk defects found in the public 1.3.2 source

1. **Uninitialized hook address.** `my_thread()` declares `u64 dlc_gxt2_addr;` and immediately tests it before assigning it. Reading this indeterminate value is undefined behavior. It must be initialized to zero before any fallback pattern scan.
2. **Unchecked pattern scans.** Several results from `PatternScan()` are passed to `memcpy_p()` and `DetourFunction()` without a complete match/length/region validation gate. A missing or ambiguous signature can produce an invalid patch address.
3. **Unsafe derived addresses.** Some scan results are adjusted by negative offsets (for example, `- 0x60` or `- 0xC`) before use. The code must validate the original match, arithmetic bounds, expected prologue bytes, and writable/executable range before patching.
4. **Version-sensitive scan windows.** The code scans hard-coded address ranges and assumes a particular no-ASLR image layout. These ranges and byte patterns are not evidence for GTA V 1.57 or 1.73 until checked against the exact regional retail executable.
5. **Incomplete failure handling.** Hook installation proceeds through multiple independent patches. The safe design is an all-required-hooks preflight: resolve every required symbol first, verify uniqueness and expected bytes, and only then install hooks. If any required hook fails, do not patch any of them.
6. **Build metadata mismatch.** `PLUGIN_VER` is set to `0x130` while the adjacent comment says `1.10`; version metadata should be reconciled with the actual source release.
7. **Makefile variable typo.** `COMMON_DIR` is declared, but `COMMONFILES` expands `COMMONDIR`. This can silently omit intended common source files.
8. **Toolchain include path risk.** The C++ include flag appends `$(TOOLCHAIN)/$(INCLUDEDIR)/c++/v1`, where `INCLUDEDIR` is the project's include directory. This appears inconsistent with the intended OpenOrbis C++ standard-library include path and should be checked in a reproducible build.

## Existing runtime behavior identified

The source contains hooks for GFX, GXT2, DLC GXT2, XML/OMT and data-loading paths, and redirects selected settings/presets paths into `/data/gta5/`. The GFX filename list includes many game UI resources. This is a custom game-memory hook plugin, not a generic loader for arbitrary PC DLL/ASI files.

## Required 1.57 / 1.73 validation process

For each region/build combination independently:

1. Record the exact CUSA title ID and game version from the installed PS4 title metadata.
2. Obtain a legally supplied, matching retail executable reference and record its SHA-256, size, ELF metadata, and relevant module mapping.
3. Resolve each hook signature against that exact executable. Record match count, address, expected surrounding bytes, and scan range.
4. Require exactly one valid match per required hook. Zero or multiple matches disable the profile.
5. Compare the original bytes and verify patch length/instruction boundaries before creating a trampoline.
6. Add host-side fixtures for signature matching, ambiguity, truncated regions, bad derived offsets, and all-or-nothing preflight.
7. Keep the 1.57 US, 1.57 EU, 1.73 US, and 1.73 EU evidence records separate.
8. Only mark a profile runtime-validated after the matching PRX has been built and the target game has been verified to load it. No such console validation is claimed here.

## Current project behavior

The PS4 manager now has selectable metadata profiles for the four target combinations. All profiles remain in safe/unverified state. The UI must not enable Project V hooks or modify game memory solely because a profile was selected.

## Sources

- Rockstar GTAV Title Update 1.73 notes: https://support.rockstargames.com/articles/4vRqEDvjUs9h7nqRUgc8YO/gtav-title-update-1-73-notes-ps5-ps4-xbox-series-x-or-s-xbox-one-pc-enhanced-legacy
- Project V 1.3.2 source: https://github.com/rfoodxmodz/GTAV-ProjectV-1.3.2
- GoldHEN plugin repository: https://github.com/GoldHEN/GoldHEN_Plugins_Repository
