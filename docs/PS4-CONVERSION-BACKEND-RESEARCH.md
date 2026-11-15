# PS4 conversion backend research

## Existing open-source reference implementation

Research identified `RaringM/ps5-gtav-menu` as a substantive PS4/PS5 custom-content pipeline, not just a plugin loader. Its documented PS4 target is **GTA V Legacy CUSA00411 version 01.57**, with custom packs marked experimental. The repository includes PC-to-PS4 resource conversion tools for vehicles, peds, drawables, maps, collision and PS4 texture dictionaries, plus a runtime custom-pack format and validator.

Upstream references:
- Repository: https://github.com/RaringM/ps5-gtav-menu
- Pack author guide: https://github.com/RaringM/ps5-gtav-menu/blob/main/docs/pack-author-guide.md
- Pack reference: https://github.com/RaringM/ps5-gtav-menu/blob/main/docs/pack-reference.md
- PS4 texture writer: https://github.com/RaringM/ps5-gtav-menu/blob/main/tools/gtavmenu_tools/ps4_texture_writer.py
- PC vehicle converter: https://github.com/RaringM/ps5-gtav-menu/blob/main/tools/convert_pc_vehicle.py
- PC ped converter: https://github.com/RaringM/ps5-gtav-menu/blob/main/tools/convert_pc_ped.py

## Important target boundary

The upstream repository explicitly supports PS4 **CUSA00411 01.57** only. Its build manifest pins executable identity, native addresses, loader hooks, custom-pack runtime, and target resources to that exact update. It refuses unknown title IDs and versions. The user-confirmed AutoPort target is **CUSA00419 GTA V 1.73**, so the 1.57 plugin, offsets, runtime pack loader and compatibility claims must not be reused as if they supported 1.73.

The converters also rely on templates extracted from the user's own matching game build. A 1.57 template cache is not evidence for 1.73. The upstream documentation describes retrieving templates from the console while GTA is running and hashing them against build-specific pins.

## AutoPort integration policy

1. Treat this project as a candidate conversion backend and study/reuse its format algorithms under its license and third-party notices.
2. Keep PC intake, diagnostics, dependency graphs and conversion logs in AutoPort.
3. Add a backend adapter only after its target profile, required Python dependencies, source formats, generated pack schema and error/refusal behavior are pinned and tested.
4. Never change the target version label on a 1.57 binary or pack to make it appear to support 1.73.
5. Do not package its 1.57 PRX or 1.57 custom packs for the user's 1.73 installation.
6. For 1.73, obtain matching PS4 resource templates and independently validate a 1.73 custom-pack loader / AFR path before emitting a GTA-installable asset.

## What this means for the first playable test

- The upstream project proves that PC-to-PS4 asset conversion is technically achievable for a pinned PS4 build, including texture, vehicle and ped workflows.
- It does **not** currently provide a verified ready-to-install package for CUSA00419 1.73.
- AutoPort must report this as a known backend candidate with a target-version mismatch, not claim that a converted output can already be installed on the user's current game.


## US target correction — CUSA00419

The active AutoPort target is the user's US-region **CUSA00419**, not CUSA00411. The earlier 01.57 backend reference remains a separate CUSA00411-specific research target and is **not** a CUSA00419/1.73 compatibility proof. Do not reuse its executable identity, offsets, PRX, resource templates, or custom-pack loader for CUSA00419. The user's report that some 01.57 mod menus still run is useful compatibility evidence for those specific menus, but it does not establish compatibility for other 01.57 binaries or assets.

The exact active target metadata is maintained in `src/core/target.js`. The user confirmed the US title ID from their own base-game PKG and reports the game update as 1.73. AutoPort still requires independent PKG metadata inspection and exact-build resource/runtime evidence; `verifiedAgainstConsole` remains false and resource compatibility remains unverified.
