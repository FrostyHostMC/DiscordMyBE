# PS4 loader ecosystem research

## Executive conclusion

There are multiple PS4 delivery mechanisms, but they are not interchangeable:

1. GoldHEN native plugins load Orbis-native PRX modules and can hook game functions.
2. GoldHEN AFR redirects game file requests into a title-specific overlay.
3. RPF packaging supplies the archive container a game subsystem requests.
4. Resource conversion must still produce a resource encoding accepted by the target game or its loader.
5. Project V may provide another resource-loading bridge, but AutoPort does not yet have a verified technical profile for its accepted inputs or target updates.

A mod can require one or more of these layers. A valid archive does not make a PC DLL executable on PS4, and a working GoldHEN plugin does not prove that arbitrary PC assets are loadable.

## Public evidence and its limits

### GoldHEN plugin framework

The official GoldHEN Plugins Repository documents GoldHEN 2.3 or newer for its plugin loader quick-start, native C/C++ plugin development and game/system function hooks, plugin files under /data/GoldHEN/plugins/, and per-title plugins.ini sections.

Source: https://github.com/GoldHEN/GoldHEN_Plugins_Repository

This confirms that a PS4-native plugin is a viable delivery class. It does not make a Windows ASI/DLL/EXE portable, nor does it provide game-specific GTA V 1.73 offsets or hooks.

### Public GTA V native-plugin examples are version-specific

- [InsulinGTAV](https://github.com/InsulinEngine/InsulinGTAV) is an OpenOrbis/GoldHEN plugin project whose repository description identifies GTA V CUSA00411 v1.57. Its README documents a PRX build using the OpenOrbis toolchain.
- [GoldSantos](https://github.com/AICyberGuardian/GoldSantos) explicitly describes itself as a CUSA00411 / GTA V 1.56 project, with separate plugin, AFR, patch and cheat layers.
- [Lotus SPRX release](https://github.com/illusionyy/PS4-GTAV-Lotus-SPRX-Release) documents a GoldHEN plugin installation and lists older GTA V updates 1.27 and 1.48.

These projects are useful architecture and build-system references only. They target different game updates and/or title IDs from AutoPort's CUSA00419 / 1.73 target. Their native offsets, crossmaps, hooks, PRX binaries and config should not be copied into the 1.73 profile.

### GoldHEN AFR

AutoPort already has a review-only AFR planner in src/core/afr.js:
- Requires explicit /app0/... mappings.
- Generates the title-specific GoldHEN plugin configuration snippet.
- Produces the documented /data/GoldHEN/AFR/<TITLE_ID>/... staging paths.
- Rejects traversal, encoded separators, Windows paths and duplicate destinations.
- Does not install AFR, connect to the console, change plugins.ini, or deploy files.

GoldHEN repository: https://github.com/GoldHEN/GoldHEN_Plugins_Repository

A community GTA V example, [GoldSantos](https://github.com/AICyberGuardian/GoldSantos), documents an AFR workflow for CUSA00411 v1.56 and says the game may request an RPF container rather than a loose internal file. This is a reason to validate the exact requested path/container for the target build—not proof that the same mapping works on CUSA00419 v1.73.

### RPF and PSO resource support

OpenIV's [PS4/Orbis announcement](https://openiv.com/?cat=11) documents beta viewing support for archives, textures, models, collision bounds, navmeshes and audio. It explicitly cautions that PS4 resources have platform-specific details and that the initial feature set did not provide openFormats export/editing.

OpenIV's [3.2 notes](https://openiv.com/?category_name=video_eng) document additional PSO/YMT support for named files, and the [OIV 2.2 specification](https://github.com/OpenIV-Team/OpenIV-PackageFormat/blob/master/specification/versions/2.2.md) documents XML-command editing for supported PSO resources. This is useful evidence for a PSO-aware metadata editing route, but support is file-specific and does not prove that arbitrary PC metadata can be serialized for Orbis.

### Full source-build route is not the default

The public [GTA V source-code build guide](https://github.com/FranklinClintonDev/gta-v-source-code-guide) identifies PS4 game version 1.46. It describes a source-build workflow, not a universal PC mod converter. Its version target differs from CUSA00419 / 1.73 and should not become a prerequisite for ordinary plugin/AFR/resource work.

## AutoPort implementation consequences

- Keep the delivery methods independent: native plugin, AFR overlay, RPF container and resource conversion are separate capabilities.
- Keep the existing AFR planner; do not create a duplicate deployment subsystem.
- Do not mark Project V as supported until a known-good mod, exact plugin version, accepted input layout and CUSA00419 / 1.73 test are available.
- Do not port old menu offsets, crossmaps or PRX files from CUSA00411 1.56/1.57 to CUSA00419 1.73.
- Treat .prx/.sprx as candidate file types only. Verify Orbis ABI, loader requirements, title ID and exact update build.
- Do not equate PC RPF extraction, PC Legacy resource round-trip, Orbis archive creation and in-game acceptance.
- Keep every generated overlay review-only until its /app0 paths and resources are validated against the exact target build.

## Evidence needed to unlock the next gates

1. A known-good Project V package with exact version and source/resource layout.
2. A known-good CUSA00419 / GTA V 1.73 plugin or AFR test that proves the expected loader path.
3. A small, user-owned reference RPF from the target update plus a matching file-open path.
4. Controlled Orbis RPF Builder outputs containing one known file each, to distinguish container encoding from resource transformation.
5. A per-format target validation set for YFT, YTD, YDR, YDD, YBN, YMAP, YTYP, YMT/PSO, audio and scripts.