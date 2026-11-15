# GTA V DLC content.xml inspection

AutoPort reads a mod's `content.xml` as a data manifest. It can list declared DLC resource paths, resource types and disabled-file entries to help explain which resources the package expects the game to mount.

## Current behavior

- Validates XML syntax and enforces a 2 MiB input limit.
- Collects declared `filename` and `fileType` pairs.
- Reports disabled-file entries and counts by resource type.
- Displays the manifest in the local workbench.
- Does not execute instructions, mount files, rewrite an RPF, or install a mod.

## Skyline import

The Skyline ZIP inventory you shared contains `content.xml` and `skyline/dlc.rpf`. Once the XML is parsed, its declared resource paths can be compared with the contents of the DLC archive. That comparison is important for finding missing metadata, models, textures, handling data and other referenced resources.

The manifest's `dlc_...` paths are PC-side identifiers. They do not prove that the same paths or mount behavior exist in PS4 GTA V CUSA00411 update 1.73. Target mapping remains blocked until exact-build reference evidence is available.

## Safety and limits

- The manifest is treated as untrusted input.
- No package commands or install operations are executed.
- Unknown or unsupported file references are preserved for review.
- A valid manifest is not proof that the referenced resources are valid, complete, or PS4-compatible.
