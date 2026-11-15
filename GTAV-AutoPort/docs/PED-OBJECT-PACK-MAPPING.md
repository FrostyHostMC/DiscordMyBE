# Ped and object pack mapping

## Ped metadata

AutoPort recognizes common ped metadata filenames (`peds.meta`, `pedalternatevariations.meta`, `pedcomponentvariations.meta`, `pedprops.meta`, `pedpersonality.meta`, and `pedgroup.meta`). It extracts candidate ped identity and texture references where present, retains each original metadata entry, and searches the imported inventory for same-name YDD/YFT/YDR and YTD candidates.

Filename matches are deliberately labeled candidate-resolved-by-name-only. They do not prove that the resource is the correct platform variant or that every skeleton, cloth dictionary, animation, expression, component, prop, audio and scenario dependency is present.

## Object and world assets

The mapper inventories drawable/fragment models, texture dictionaries, collision, archetypes, map placements, animation/effect and related world-resource files. Same-stem resources are shown as co-located candidates only; YMAP/YTYP binary references still need resource-level parsing and a full dependency resolver.

## Spawn configuration

XML, JSON and INI configuration is parsed for model references, position/rotation vectors, heading, ped/object fields, spawn counts, scenarios and archetype references. The original parsed configuration is retained in the exported analysis. These values are not executed and do not by themselves create game entities.

## Remaining PS4 work

- Map ped model/texture/component/prop metadata to exact target resources.
- Resolve skeletons, cloth, animation dictionaries, expression sets, scenario/relationship data and audio references.
- Resolve object archetypes, collision bounds, material/texture references, YMAP placements and streaming bounds.
- Implement verified spawn/menu actions for peds and objects, including transforms, scenarios, AI and cleanup.
- Produce target-compatible resources and validate them in GTA V Story Mode on CUSA00419 update 1.73.

The exported `autoport-ped-object-pack` is an analysis/interchange report, not a PS4-ready content pack.