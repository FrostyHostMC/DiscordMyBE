# GTA V mod-port format research and backend selection

Research checked 2026-11-13. This records public tool capabilities and gaps for the user's CUSA00411 / GTA V 1.73 PS4 Story Mode target. A tool's ability to read/write PC or Enhanced assets is not evidence of PS4 compatibility.

## Best reuse candidates

### ragekit — primary native-backend candidate
Repository: https://github.com/RatPrez/ragekit
License: MIT (repository README; vendored dependencies include public-domain miniz and Boost-licensed Clipper2).

The project describes a C++20 library for GTA V Legacy and Enhanced resources. Its published matrix lists read/write support for RSC7, YTD, YDR, YDD, YBN, YFT, YNV, YPT, YLD, YTYP/YMAP, PSO/RBF, XML metadata, REL, GXT2, RPF and additional formats. It documents round-trip checks over 4,958 sampled install files and CodeWalker comparison; those checks do not execute the game. The README lists typed common PSO models and animation-channel decoding among remaining gaps.

Assessment: strongest candidate for a broad native resource engine and independent validation oracle. It is not documented as a PS4 resource encoder. Treat its output as PC Legacy/Enhanced until exact PS4 target fixtures prove otherwise. Integrate behind an adapter boundary.

### FiveFury 0.5.1 — secondary parser/authoring candidate
PyPI: https://pypi.org/project/fivefury/0.5.1/
Source: https://github.com/MrVicho13/FiveFury
License: Unlicense.
Requires Python 3.11+; a Windows x64 wheel is published.

Published scope includes YMAP, YTYP, YMF, GTXD, YDR/YDD/YFT/YTD, YBN/YND/YNV, YCD/YED/CUT, AWC/REL/GXT2, RPF7, DLC metadata and PSO/RBF. Some variants remain partially understood, particularly YFT, REL, YED and YMT; console CDR and PS3 RPF support is focused on reading/extraction. Version 0.5.1 is described as the last planned feature release of the Python implementation, with core development moving to .NET.

Assessment: useful broad format research, fixtures and supplemental inspection. No PS4 1.73 writer claim is documented.

### Existing rage-formats Rust crate — keep as current inspector
Repository: https://github.com/VIRUXE/rage-formats
License: Unlicense.

Its current matrix reads YTD, YDR, YDD, YFT, YBN, YMAP, YTYP, YMT, vehicle metadata, carcols/carvariations, peds and manifests. Published writer entries include YNV and YND; YTD/YDR/YDD/YFT/YBN/YMAP/YTYP are not listed as writable.

Assessment: keep current automatic read-only YFT/YTD inspection; do not treat it as a PS4 writer.

### RPF archive engine
Repository: https://github.com/VIRUXE/rpf-archive-rs
It documents RPF0–RPF8 and IMG archives, nested extraction, GTA V encryption support with caller-supplied keys, archive writing and DLC load-order parsing. Verify its current license and maintenance before bundling. Archive writing is container work only; it does not convert payload resources.

### Sollumz / Blender
Repository: https://github.com/Sollumz/Sollumz
License: GPL-3.0-or-later.
Provides import/export and authoring workflows for YDD, YDR, YFT, YBN, YTYP, YCD and partial YMAP, including models, maps, interiors, animations, bones, normals, shaders and vehicle creation.

Assessment: strong artist-facing fallback and geometry/material inspection tool, but not an unattended converter or PS4 encoder.

## PS4-specific findings

### OpenIV
OpenIV's 2018 PS4 announcement described Orbis support as beta and said it could open archives, textures, models, collision bounds, navmeshes and audio, but did not provide openFormats editing/export for PS4 at that time. This is historical evidence of platform-specific RAGE resource differences, not a current specification for GTA V 1.73.

### GoldHEN native runtime
GoldHEN's Plugins SDK is an MIT-licensed Orbis PRX hook/patch SDK requiring the OpenOrbis PS4 toolchain and LLVM. It can support separately engineered PS4-native runtime plugins; it does not load Windows ASI/DLL files as-is.

A public project, InsulinEngine/InsulinGTAV, documents a CUSA00411 v1.57 GoldHEN plugin built with OpenOrbis. This is evidence that native work exists for the same title ID, but not a compatibility proof for 1.73 and not a universal PC script/plugin bridge.

## Architecture decision
1. Keep current Rust inspector for safe, automatic, read-only YFT/YTD reports.
2. Build generic content classification and mod audit at intake (implemented in modClassifier.js).
3. Add a native-engine abstraction so ragekit, FiveFury and existing Rust parsers can be called as independently versioned backends.
4. Evaluate ragekit first for broad Legacy resource decoding/writing and round-trip validation; evaluate FiveFury as supplemental format coverage. Neither backend may emit "PS4-ready" by default.
5. Keep archive handling separate from payload conversion: RPF repacking cannot repair PC-only resource layout.
6. Add a PS4-specific adapter only after obtaining lawful, unmodified resources from exact CUSA00411 / 1.73 and validating the executable/build fingerprint.
7. Treat PC ASI/DLL/EXE, ScriptHookV, .NET and Windows API-dependent mods as behavior-reimplementation projects. A PS4 PRX requires separate native code, API compatibility and target-build validation.

## Important limits
- Public project support matrices are maintainer claims; AutoPort must pin versions and run its own fixtures.
- Round-trip parser tests do not prove game runtime compatibility.
- Target version supplied by the user remains unverified against console files.
- Do not bundle game files, keys, third-party mods or copyrighted assets. Keep user-supplied content local.
