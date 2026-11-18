# Deep PS4 Asset and Runtime Research — 2026-11-18

## Scope and source inspected

This round inspected the current source tree of RaringM/ps5-gtav-menu, including its PS4 target manifest, converter scripts, PS4 resource validators, custom-pack parser/runtime and plugin entry/runtime.

Source: https://github.com/RaringM/ps5-gtav-menu
Reviewed revision: 7ed032cbe435869c7eb1050cef237bbefe9d5e50.

The inspected PS4 profile is EU GTA V Legacy CUSA00411 / 01.57. Its executable identity, native addresses, signatures, generated headers, resource assumptions and PRX are target-specific. They are not a US CUSA00419 profile and must not be reused for the user's target.

## 1. Actual PS4 support boundary

The project has a broad PC/PS5 content converter catalogue, but the PS4-specific guide and capability policy document a narrower lane:
- PS4 custom packs support vehicle packs and stock vehicle replacements.
- Vehicle packs include models, textures and five vehicle metadata files.
- The PS4 lane refuses maps, archetypes/typs, collision, ped/clothing data, weapon components, custom wheels and mod kits.
- The broad PS5 converter list must not be represented as PS4 support.

AutoPort should classify a mod by individual components. A vehicle body may be a candidate while its custom wheels, map, collision, audio or scripts remain unsupported. Preserve excluded inputs and explain every refusal.

## 2. PS4 resource formats

The pack schema uses platform-specific resource member extensions:
- PC Legacy YFT fragment to PS4 OFT
- PC Legacy YTD texture dictionary to PS4 OTD
- PC Legacy YDR drawable to PS4 ODR
- PC Legacy YDD drawable dictionary to PS4 ODD

Changing extensions alone is not conversion.

### 2.1 Fragment conversion

The public PS4 fragment converter uses CodeWalker.Core to load and serialize a Legacy RSC7 fragment. It requires Legacy fragment version 162.

Its resource walk covers main, array, cloth and physics-child drawables, LODs and extra model lists. It specifically repairs the skinned BlendIndices declaration:
- PC Legacy commonly encodes BlendIndices as Colour (component type 9).
- The inspected stock PS4 fragments use UByte4 (component type 8), representing integer bone indices.
- Both occupy four bytes, so the converter changes declaration metadata while preserving vertex payloads.
- It fingerprints declarations, vertex buffers and index buffers before and after serialization, and refuses output if the geometry structure or payloads change unexpectedly.

This is a concrete platform-specific rule, not a universal YFT converter. Unsupported declarations, malformed input, unhandled dependencies and other layout differences still require refusal or manual repair.

### 2.2 Texture conversion

The PS4 texture writer is distinct from the PS5 writer. Its reviewed PS4 profile uses:
- RSC7 texture dictionary version 13.
- BC1, BC3 and BC5.
- GCN Thin1DThin 8x8 Morton-ordered microtiles.
- Per-mip padded storage, pitch and offset views calculated from the same layout as the pixel allocation.
- Exact stock PS4 texture donor metadata taken from the user's own 1.57 game resources.

The writer validates allocation size, alignment, mip count, view entries, tile mode, tile index and object metadata, then re-parses the written dictionary.

The PC texture conversion path can transcode some source formats:
- BC2/DXT3 to BC3.
- Uncompressed BGRA8, BGRX8, RGBA8, A8 and L8 to BC3.
- BC7 to BC3 using a decode/re-encode path, which is lossy.
- Optional mip trimming with an explicit maximum texture size.

PS4 donor templates are required; the writer refuses to invent native metadata. This is a useful design for AutoPort: conversion, tiling, donor provenance, bounds checks and read-back validation are explicit stages. RageKit's PC Legacy/Enhanced YTD support is not a substitute for this PS4 layout.

### 2.3 PS4 resource validation

The PS4 pack validator checks more than the RSC7 header:
- Fragment version and readable fragment structure.
- Skinned vertex declaration BlendIndices encoding.
- Texture dictionary version and texture metadata.
- BC1/BC3/BC5 Thin1DThin tile mode, tile index, allocation, mip views and packed allocation size.

Unsupported texture formats are warned as outside the tiling check, not silently treated as proven. This illustrates the validation standard AutoPort should use.

## 3. Runtime architecture observed

The PS4 source tree separates target identity/configuration, plugin entry and lifecycle, frame hook, native bridge, pad input, custom-pack parsing/runtime, platform/storage services, feature modules, boot-pool handling, logging and shutdown.

The plugin guide says it waits for Story Mode, checks the exact game build, then hooks the game. It logs each launch and documents cooperative shutdown/restoration. Some pool changes require the plugin to load early in a cold launch.

The PS4 target manifest binds the build to executable identity evidence and a generated native-address profile. AutoPort should follow this pattern: every build-specific hook must be gated by exact target identity; unknown builds fail closed.

### 3.1 Capability policy

The PS4 capability file explicitly locks actions not implemented in its PS4 custom-pack lane, including map/typ/bounds loading, weapon-component toggles and retail export. Other actions are grouped by the runtime services they require.

AutoPort should adopt a per-target capability matrix:
- Each action declares the services it needs.
- Each target profile declares which services are available.
- Unsupported actions remain visibly locked with a reason.
- The UI reports support per feature, not one vague overall compatibility flag.

### 3.2 Pack contract

The custom-pack format uses a bounded, versioned manifest plus archives and metadata. The parser checks identifiers, paths/names, row order, platform-specific extensions, coordinates, file sizes and hashes. The host validator checks pack contents, cross-pack conflicts, dependencies, active limits and PS4 resource structure.

AutoPort should use these concepts in its own schema, while adding source provenance, target title/build, adapter version, dependency graph, conversion report, hashes, warnings and feature requirements.

## 4. AutoPort implications

Do not treat PS4 output as one generic YFT/YTD writer. Separate the pipeline:

1. Parse PC Legacy source using RageKit and existing source-side tools.
2. Normalize geometry, skeleton, material, shader, texture and dependency data into a platform-neutral intermediate representation.
3. Apply explicit PS4 transformations such as vertex declaration repair, PS4 resource layout and texture tiling.
4. Require verified target templates and record their hashes/provenance.
5. Write the PS4 resource.
6. Read it back with an independent validator.
7. Validate pack references, limits and dependencies.
8. Only then mark it as a candidate for on-console testing.

For a vehicle mod, report each component separately: fragment/model, textures, vehicle metadata, wheels, collision, audio and script dependencies. Do not discard unsupported files or mark the entire mod converted because one component succeeded.

## 5. CUSA00419 remains a separate evidence gate

The inspected target profile and generated data are for CUSA00411. The profile includes executable identity, native addresses, capability policy, script-global anchors, custom streaming-lane evidence and boot-pool data. None of those facts are automatically region-neutral.

For US CUSA00419 1.57 AutoPort needs its own:
- User-owned executable identity and hash.
- Independently derived and verified native/function signatures and argument contracts.
- Separate hook/ABI profile.
- Matching retail resource templates.
- Target-specific read/write/read-back fixtures.
- Minimal PRX load and Story Mode test.
- One low-risk resource replacement test with rollback.

A matching game version string (1.57) is not sufficient.

## 6. Proposed AutoPort adapter boundary

| Adapter | Responsibility | Required proof |
|---|---|---|
| PS4 fragment | Convert and validate PS4 fragment declarations/layout | CUSA00419 fixtures, read-back and in-game render |
| PS4 texture | Convert supported formats into PS4 tiled OTD | Target donor templates, mip/layout validation and in-game texture test |
| PS4 vehicle metadata | Map/validate accepted vehicle data files | Exact target loader contract and pack test |
| PS4 pack writer | Manifest, archives, hashes, conflicts and limits | Agreement with the runtime parser |
| PS4 runtime | Native PRX services, feature modules and pack loading | CUSA00419 identity and on-console tests |
| Script behavior | Rebuild selected PC behavior against native services | API semantics mapping and feature-specific tests |

RageKit remains the source-side parser/inspector and PC resource backend. Add a separate PS4 adapter rather than labeling PC Legacy output as PS4-ready.

## 7. Next research tasks

1. Inspect CodeWalker.Core's exact PS4 serialization behavior, version and license/dependency obligations.
2. Determine which PS4 texture formats beyond BC1/BC3/BC5 can be supported and what donor fixtures they require.
3. Inspect the PS4 custom-pack mounter to understand RPF archive registration, resource stores and metadata loading.
4. Search for independently documented CUSA00419 1.57 custom-pack loaders and verify provenance.
5. Inspect Luma's Lua runtime source, language version, API, scheduling, control channel and target restrictions. An editor extension is not the runtime.
6. Map ScriptHookV, SHVDN and RPH APIs to AutoPort's capability model, prioritizing common gameplay behavior.
7. Build automated fixture tests from user-owned target resources and compare read-back output with independent parsers.

## Conclusion

This source inspection exposed concrete PS4 engineering requirements: fragment BlendIndices repair, GCN texture tiling, stock donor metadata, read-back validation, target-specific capabilities and a bounded pack contract. It also confirms that the inspected PS4 implementation is EU CUSA00411-specific and narrower than its PS5 converter catalogue. These findings improve AutoPort's engineering plan but do not unlock the user's US CUSA00419 target.
