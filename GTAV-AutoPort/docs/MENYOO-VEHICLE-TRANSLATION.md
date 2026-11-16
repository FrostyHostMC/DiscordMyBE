# Menyoo / Spooner vehicle XML translation

## Stage 1 scope

AutoPort now parses Menyoo/Spooner vehicle preset XML into a loss-preserving intermediate pack. It extracts, when present:

- vehicle model name and raw/unsigned model hash;
- world position, rotation and heading;
- attachment model identifiers, bone references, offsets and rotations;
- vehicle property/modification nodes;
- the complete original placement subtree for fields not yet understood.

The workbench can export `*.autoport-vehicles.json` from the translated report. The export is an interchange format for the next adapter stage, not a Synapse catalog file and not a PS4-ready spawn package.

## Why the export is not yet directly loadable

The supplied Synapse package had JSON catalogs for vehicle/model/object names but no XML examples and no documented runtime schema. A list of model names is not proof that the menu can spawn an entire saved vehicle, apply its transform, configure modifications, or create attached objects.

Before marking a translated vehicle as runnable, the menu/runtime needs a confirmed contract for:
1. spawn vehicle by a supported model hash/name;
2. apply world coordinates, rotation and heading;
3. map supported vehicle properties to game-native setters;
4. create each attachment, resolve its bone and apply local offset/rotation;
5. report unsupported source fields rather than silently dropping them.

A known-good XML preset that the user has successfully loaded on the target console remains the golden compatibility fixture. Until that is available, Menyoo schema parsing is source-side only.

## Safety and limits

- XML size is capped at 8 MiB and placement count at 5,000.
- Invalid XML returns an explicit parse failure.
- Source placement objects are retained to prevent data loss while mappings expand.
- The translator does not write YFT/YTD, compile PRX, modify the menu binary, or claim CUSA00419 / update 1.57 runtime validation.
