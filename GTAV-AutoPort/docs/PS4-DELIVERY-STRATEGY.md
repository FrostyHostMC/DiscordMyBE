# PS4 delivery strategy planner

## Purpose

The preparation pipeline previously stopped after source preservation, dependency
analysis and PC Legacy candidate generation. This planner adds an explicit,
per-file delivery decision so the next backend can be integrated without
conflating PC RPF extraction, PC Legacy resource rewriting, Orbis archive
creation, Project V loading and GoldHEN plugin deployment.

## Current routes

| Route | Input family | Meaning |
|---|---|---|
| `preserve-pc-runtime-only` | ASI, DLL, EXE, SYS | Keep Windows code as source; it is not a PS4 plugin |
| `validate-orbis-plugin` | PRX, SPRX | Require Orbis architecture, loader, title and update validation |
| `inspect-contents-then-package` | Extracted PC RPF7 OPEN | Raw extraction succeeded; inspect resources and dependencies before packaging |
| `preserve-and-identify-archive` | Unsupported/encrypted RPF | Preserve bytes; do not guess at archive markers or encryption |
| `resource-loader-compatibility` | YFT, YTD, YDR, YDD, YBN, YMAP, YTYP, YMT, etc. | Require a format-specific parser and a verified target loading/conversion route |
| `metadata-translation-review` | META, XML, INI, scripts/config | Parse and translate the internal format; extension renaming is not conversion |
| `pso-metadata-edit-review` | YMT, YMF, YTYP, YMAP, PSO | Identify the exact binary PSO variant; only use file-specific, tested metadata editing |
| `source-asset-conversion` | FBX, OBJ, DDS, PNG, WAV, etc. | Require game-compatible resource export and validation |
| `preserve-and-review` | Unknown | Keep source and require a format adapter before conversion |

## Safety contract

- This is a deterministic planning report, not a converter or installer.
- A successful PC Legacy resource round-trip is recorded only as `pc-candidate-only`.
- `ps4ReadyFiles` remains zero and `installable` remains false until a
  target-specific validator explicitly proves otherwise.
- The planner does not execute Lua recipes, external executables, mod scripts,
  XML instructions or plugin binaries.
- It does not rename YMT to OMT automatically.
- It records CUSA00419 / 1.73 as the requested target but does not mark that
  target verified merely because the target fields are present.
- The Orbis builder remains explicitly not integrated; Project V remains unconfigured.
- GoldHEN AFR configuration and explicit-mapping overlay planning already exist in `src/core/afr.js`; this planner reports that capability without claiming console deployment.

## Next implementation boundary

The next separate work items are (1) a sandboxed Orbis builder runtime adapter
with capability detection and output validation, (2) evidence-backed Project V
loader profiles based on known-good files and on-console tests, and (3) a
resource-specific conversion/validation matrix. The planner is the seam that
will route each imported resource to those backends when they exist.

## PSO/YMT research boundary

OpenIV's official release notes document PS4/Orbis support for viewing archives,
textures, models, collision bounds, navmeshes and audio as beta functionality.
OpenIV 3.2 later documents support for specific PSO-backed YMT files and XML
command editing for supported PSO files. This is evidence that some metadata
can be edited through a PSO-aware workflow; it is not evidence that arbitrary
YMT files can be renamed to OMT, that every YMT is supported, or that an edited
PC-side file is automatically accepted by a PS4 1.73 loader.

References:
- https://openiv.com/?cat=11
- https://github.com/OpenIV-Team/OpenIV-PackageFormat/blob/master/specification/versions/2.2.md

AutoPort therefore gives PSO-like metadata its own review route and keeps
format parsing, semantic editing, target serialization and loader compatibility
as separate validation stages.
