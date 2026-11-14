# Upstream tool integration register

Last reviewed: 2026-11-14

This register separates actual runtime/build dependencies from research references. AutoPort does not vendor upstream source by copying arbitrary files into this repository. Where possible it pins a version and fetches the dependency at build time so upstream licensing, provenance, and updates remain visible.

## Integrated now

### RatPrez/ragekit v0.3.1 — primary native RAGE engine

- Repository: https://github.com/RatPrez/ragekit
- License: MIT (review upstream notices for bundled dependencies).
- Integration: `native-engine/CMakeLists.txt` uses CMake FetchContent with the exact `v0.3.1` tag and builds the `rk` CLI.
- AutoPort adapter: `ragekit-plugin.js` invokes `rk info` and `rk roundtrip` through local Vite middleware; `src/core/ragekit.js` selects supported file families.
- Use: inspect and read/write-round-trip supported RAGE resources and RPF archives on the source-side toolchain.
- Boundary: upstream documents GTA V Legacy and Enhanced support. This is not a PS4 1.73 encoder. A successful round-trip only establishes that this backend parsed and rewrote that particular input.

## Evaluated, not yet integrated as a runtime dependency

### VIRUXE/rpf-archive-rs

- Repository: https://github.com/VIRUXE/rpf-archive-rs
- Potential use: dedicated RPF extraction/repacking backend if RageKit's RPF handling proves insufficient for a required archive.
- Decision: do not add a second archive engine yet. RageKit already advertises RPF7 read/write support, so duplicate archive implementations would add maintenance and key-handling complexity without demonstrated benefit.
- Before adoption: re-check current license, supported RPF variants, key handling, and write behavior against user-owned archives.

### MrVicho13/FiveFury

- Repository: https://github.com/MrVicho13/FiveFury
- Potential use: supplemental parser/inspection backend for resource families or metadata variants not handled adequately by RageKit.
- Decision: research candidate only. Do not install a Python runtime or make it a required dependency until a concrete format-coverage gap and stable command/API contract are demonstrated.

### Sollumz

- Repository: https://github.com/Sollumz/Sollumz
- Potential use: optional artist-facing Blender import/export workflow for geometry, materials, collision, and map assets.
- Decision: not part of the unattended conversion path. It requires Blender and human authoring; it is not a PS4 encoder.

## PS4 research references only

### AICyberGuardian/GoldSantos

- Repository: https://github.com/AICyberGuardian/GoldSantos
- Its README describes a CUSA00411 GTA V v1.56 GoldHEN-oriented modding suite, staged asset redirection, RPF tooling, and LAN deployment scripts.
- Decision: inspect its architecture and scripts for reusable concepts, but do not copy its payloads or treat its claims as verified for GTA V 1.73. The documented game build is 1.56, so its offsets, paths, resource assumptions, and PRX code are not drop-in compatible with the target.

### InsulinEngine/InsulinGTAV

- Repository: https://github.com/InsulinEngine/InsulinGTAV
- Its README describes an OpenOrbis-built GoldHEN PRX plugin for CUSA00411.
- Decision: native PS4 plugin build-system reference only. The repository's associated target evidence is GTA V 1.57, not 1.73. Do not deploy its PRX to the user's game or infer that it ports PC ASI/DLL behavior.

### OpenIV

- Historical reference: https://www.gta5-mods.com/tools/openiv
- Its 2018 PS4 announcement described beta support for opening PS4 archives and viewing selected resource families, not a current general-purpose PS4 editing/export pipeline.
- Decision: format research only; no redistributable executable is bundled.

## Runtime architecture decision

1. Keep the browser UI as the front end, but run native engines through a local desktop/helper process. A browser page cannot directly spawn arbitrary native executables.
2. Keep RageKit as the primary source-side parser/writer. Add another backend only behind an explicit adapter when it demonstrably covers a missing format.
3. Keep archive operations separate from resource conversion. Repacking an RPF does not transform a PC resource into a PS4 resource.
4. Build a PS4-specific target adapter only from lawful, user-owned CUSA00411 / 1.73 reference files and independently validated format evidence.
5. Treat PC ASI, DLL, EXE, ScriptHookV, .NET and Windows API-dependent behavior as separate reimplementation work. They are not converted by copying files or changing extensions.
6. Never emit an installable PS4 package while the target resource writer, dependency validation, deployment path, and rollback checks are unverified.

## What this means for the first in-game test

The project is not ready to claim an installable mod yet. RageKit's native build is working in CI, but its current integration is a source-side inspection/round-trip check. GoldSantos and InsulinGTAV target older game updates. The remaining blocker is a validated CUSA00411 / 1.73 PS4 resource pipeline and deployment method—not the lack of another generic PC RAGE parser.
