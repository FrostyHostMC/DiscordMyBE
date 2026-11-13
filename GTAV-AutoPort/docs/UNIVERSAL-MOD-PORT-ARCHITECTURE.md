# Universal GTA V PC-to-PS4 Story Mode mod-port architecture

## Product goal
GTAV AutoPort is a general-purpose porting platform for GTA V PC mods to the user's PS4 Story Mode target (currently user-specified as CUSA00411 / update 1.73; not independently verified). It is not vehicle-only. Vehicles are one asset family; the Crown Victoria is only an early intake/inspection fixture.

The long-term intake goal is broad: accept arbitrary legally supplied PC mod archives/folders, identify contents, analyze dependencies, and route each component through the correct source decoder and PS4 target adapter. "Universal" describes the architecture and breadth of supported categories, not a promise that every mod can automatically be translated. Every format and feature needs an explicit support state and verified conversion path.

## Mod families to recognize
- Vehicles: replacement/add-on vehicles, models, textures, collision, handling, variations, liveries, damage/LOD assets, mod kits and audio references.
- Peds/player models: meshes, skeletons, clothing, accessories, textures, component variations and metadata.
- Weapons: models, textures, animations, effects, audio and weapon metadata.
- Props/world objects: drawables, textures, collision, archetypes and placement metadata.
- Maps/world/environment: map fragments, drawable dictionaries, collision, YMAP/YTYP/YBN/YDR/YDD/YTD resources, timecycle/weather/environment data and dependencies.
- Textures/visual replacements: texture dictionaries, shaders/materials, decals, UI textures and supported visual effects.
- Audio: supported audio containers, banks, metadata and references, subject to PS4 format/runtime validation.
- Animation: animation dictionaries/clips, skeleton compatibility, task/clip references and metadata.
- UI/HUD/frontend assets: textures, scaleform-like assets, configuration and other resources only where a compatible PS4 runtime path exists.
- Scripts/gameplay systems: source code/configuration and behavior descriptions, classified separately from binary assets.
- Native plugins/loaders: ASI/DLL/EXE, ScriptHookV, .NET assemblies, RAGE Plugin Hook and other PC runtime extensions.
- Unknown formats: preserve inventory, hashes, paths and diagnostics; never silently discard or assume extension proves content.

## Compatibility classes
1. **Directly portable data** — semantics and target representation are demonstrably compatible; references and target build still require validation.
2. **Convertible asset** — supported source decoder and target encoder exist and pass round-trip/in-game validation.
3. **Requires adaptation** — understood source content needs a PS4-specific replacement, shader/material mapping, metadata rewrite or behavior reimplementation.
4. **Runtime-dependent / not directly portable** — depends on Windows APIs, PC executables, ASI/DLL injection, ScriptHookV, .NET, RAGE Plugin Hook, external services or PC-only hooks. Never copy these binaries to PS4 or label them converted. A PS4-native implementation may be possible only with source/permission, a compatible loader/API and separate engineering.
5. **Unsupported / blocked** — no safe decoder/encoder, unknown semantics, missing dependency, incompatible target capability or insufficient validation evidence.

The app explains why each item received its classification, dependencies, adaptation needed and whether it blocks packaging. Partial-port reports are useful, but unsupported components may never be silently omitted from a supposedly complete package.

## Universal pipeline
1. Safe intake: ZIP/folder, traversal/symlink/duplicate/size protections, hashes, original paths, provenance/licensing notes.
2. Content identification: signature/magic and structural probes in addition to extensions; identify platform/version only when proven.
3. Mod-family detection: vehicles, peds, weapons, maps, props, audio, animation, UI, scripts/plugins, configuration and unknown files.
4. Dependency graph: parse manifests/metadata, resolve references across archives and DLC layouts, detect cycles, missing/ambiguous references and load-order constraints.
5. Source decoding: isolated, versioned parsers; resource families do not share one assumed binary layout.
6. Platform-neutral IR: typed resource graph preserving geometry, vertex declarations/buffers, skeletons, fragment physics, materials/shaders, textures/mips, collision, animation, audio metadata, map placement, script semantics and provenance.
7. Capability planning: compare each IR node with the exact PS4 adapter's supported features and runtime APIs; create an adaptation plan and explicit blockers.
8. Target encoding/adaptation: resource-family-specific PS4 writers and metadata transforms; no header renaming or byte-copy shortcut.
9. Independent validation: reopen outputs with separate readers; compare invariants, dependencies, hashes and target constraints.
10. Packaging: reversible Story Mode package only when required components pass; include manifest, target fingerprint, backups, rollback and per-component report.
11. Runtime validation: test on a backed-up PS4 Story Mode target. No GTA Online support.

## Intermediate representation
The IR is a versioned typed resource graph, not a single mesh schema. It includes project/source/target identity and toolchain provenance; resource nodes with hashes, original paths, type and source version; typed dependency edges/load order; geometry, vertex layouts, materials, shaders and textures; skeletons, animation clips, fragment hierarchy, physics and collision; map archetypes, placements, bounds and environment settings; audio metadata and references; parsed metadata/configuration plus source locations and unknown-field preservation; script behavior descriptions and runtime/API dependencies; and per-node conversion result, adapter identity, validation evidence and unsupported-feature reasons.

Unknown fields/resources remain opaque in the analysis project, not dropped. Opaque data is not automatically eligible for PS4 packaging.

## Adapter/plugin model
Adapters are independent by resource family and source/target version. Each declares source platform/edition and accepted versions; target platform/title ID/exact executable fingerprint; supported resource types and feature matrix; decoder/encoder versions; compression, texture, alignment, pointer/page and metadata capabilities; runtime dependencies and required PS4-native support; independent validation method and fixture provenance/hashes; known limitations and failure modes.

Adding a resource family means adding decoders, IR mapping, target adapters where feasible, validators and fixtures—not a one-off special case in the main pipeline.

## PS4 evidence and limitations
The target label CUSA00411 / GTA V 1.73 is user-supplied and not independently verified. Obtain lawful, unmodified reference resources from the exact target installation and record provenance/hashes before claiming compatibility. Determine actual GoldHEN version and file-redirection capabilities separately.

PC ASI/DLL/EXE plugins, ScriptHookV scripts and Windows/.NET runtime dependencies are not interchangeable with PS4 native plugins. A PC script may be reimplemented only when behavior is understood and an appropriate PS4-native runtime/API exists. Never package PC binaries as PS4 plugins.

Current project capabilities: intake, metadata inspection, read-only PC YFT/YTD inspection, automatic local inspection integration and an initial generic vehicle dependency inventory. Not implemented: general IR, PS4 resource encoders, complete cross-family dependency resolution, PS4-native script runtime, exact-build validation or installable deployment package.

## Universal support policy
- No model-name, vehicle-class, filename, archive-layout or fixed-asset-count assumptions in shared pipeline code.
- No "supports all mods" claim until per-family/per-format adapters have independent validation.
- Unknown and unsupported content remains visible with reasons and dependencies.
- No copyrighted mod/game binaries in the repository without redistribution rights.
- No destructive game-file overwrites; package with backup and rollback.
- No GTA Online features or online cheating support.
- PC-side parsing alone never enables deployment.


## Research-driven backend strategy (2026-11-13)
See [FORMAT-RESEARCH.md](FORMAT-RESEARCH.md) for detailed tool comparison. Evaluate ragekit first as the broad native read/write engine, FiveFury as supplemental format research, and keep rage-formats as the current read-only YFT/YTD inspector. Keep RPF archive operations separate from payload conversion. No candidate currently establishes PS4 CUSA00411 / 1.73 write compatibility.
