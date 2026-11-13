# Universal vehicle port architecture

## Product requirement
GTAV AutoPort is a general vehicle-mod porting workbench, not a converter for the first Glendale fixture. Glendale is only the first regression fixture. No model name, texture dictionary name, handling ID, vehicle make, file count, LOD count, or source archive layout may be hardcoded as a conversion assumption.

The source goal is any legally supplied GTA V PC vehicle mod archive or extracted folder. The initial target is the user's GTA V PS4 Story Mode installation, recorded as CUSA00411 / update 1.73 but not independently verified. Replacement and add-on vehicles are distinct project types: replacement is the first implementation target; add-on requires additional DLC/archive/manifest/dependency work and must not be mislabeled as supported until validated.

## Required pipeline
1. Intake and provenance: safely inventory archive entries, preserve relative paths, hashes, source metadata and licensing/provenance notes. Never modify source files.
2. Classification: identify resource types by content and parser, not extension alone. Distinguish vehicle assets, shared dictionaries, collision, audio, metadata, DLC manifests, scripts and unrelated files.
3. Dependency graph: resolve model, texture dictionary, handling, vehicle variations, carcols, mod kits, audio, layouts, damage/LOD and collision dependencies. Report unresolved and ambiguous references rather than guessing.
4. Source decoding: decode supported PC resources into a documented platform-neutral intermediate representation (IR). Keep source bytes and reversible mappings to original resource names.
5. IR validation and normalization: validate geometry, vertex attributes, UVs, normals, tangents, material/shader parameters, texture references, skeleton/bone tags, fragment hierarchy, physics bounds, damage states, LODs, glass, lights and collision. Unsupported constructs become explicit blockers.
6. Target adapter: serialize IR into the exact target platform/build's resource layout, texture formats, alignment, compression, pointer/page layout and metadata encoding. Adapter capabilities are explicit and versioned.
7. Round-trip validation: reopen every emitted resource with an independent parser; compare geometry/texture/material/fragment/dependency invariants; verify referenced names and hashes resolve.
8. Package and deployment: build only a reversible Story Mode replacement package with original-file backups, manifest, hashes, target fingerprint and rollback instructions. No GTA Online support.

## Intermediate representation (IR)
The IR must be vehicle-agnostic and versioned. A vehicle project contains:
- project: schema version, source identity, target profile, conversion profile and toolchain versions.
- vehicle: logical model name, replacement/add-on mode, vehicle metadata, handling reference and dependency identifiers.
- models: source resource identity, LOD role, geometry collections, vertex declarations and buffers, bounds, material slots, skeleton and bone mappings.
- fragments: drawable hierarchy, physics groups/children, transforms, joints, breakable/damage parts and fragment bounds.
- materials: shader family, parameters, texture slots, render flags and source references.
- textures: logical name, dimensions, mip chain, pixel format, color space, alpha semantics and decoded pixel payload.
- collision: bound types, transforms, materials, flags and geometry.
- metadata: parsed vehicle/handling/variation/carcols/mod-kit/audio/layout records and original source document locations.
- dependencies: typed edges with resolved, missing, ambiguous or optional status.
- diagnostics: severity, source path, parser, byte offset when available, and actionable explanation.

Do not flatten the IR to a simple mesh plus diffuse texture. That loses essential GTA vehicle data such as fragment physics, damage models, shader parameters, LODs, collision, glass, lights and metadata.

## Adapter contract
Each adapter declares source platform/edition and accepted resource versions; target platform, title ID and exact game-build fingerprint; supported resource kinds and feature matrix; decoder/encoder versions and compression/texture capabilities; unsupported-feature policy; independent validation method and test fixture hashes.

A PS4 adapter cannot be marked production-ready from a PC parser succeeding. The current rage-formats integration is a read-only PC-side inspector for YFT/YTD; its documented parser API does not provide YFT/YTD writers. A separate encoder or explicitly supported writer implementation is required.

## PS4 evidence requirement
OpenIV's original PS4 announcement described Orbis support as beta and stated that PS4 RAGE resources had platform-specific details; at that time it offered inspection but no openFormats editing/export. This is a reason not to assume PC resource output is PS4-ready. References:
- https://openiv.com/?cat=23&page=&paged=2
- https://openiv.com/bugs/changelog_page.php?project_id=1
- https://github.com/VIRUXE/rage-formats

Before implementation can be validated, obtain legally accessible, unmodified PS4 reference resources from the exact CUSA00411 / GTA V 1.73 installation, with provenance and hashes. At minimum: a base-game vehicle YFT (including high LOD/damage parts where present), matching YTD, relevant collision/metadata, and corresponding retail archive context. Record actual GoldHEN version and file-redirection capability separately; GoldHEN plugin version is not a substitute for game-build identification.

## Universal compatibility policy
- Never hardcode glendale, GLENDALE, BENEFAC, a fixed number of YFTs, or one texture dictionary.
- Never assume every mod is a replacement; distinguish replacement versus add-on intent.
- Never silently discard unknown resources or metadata fields.
- Never claim all vehicle mods are supported. Publish a per-feature support matrix and diagnostics.
- Add fixtures from different vehicle classes and mod authors, with redistribution rights confirmed; keep copyrighted binaries out of the repository.
- Conversion and deployment stay disabled until exact-target writers and independent round-trip validation pass.

## Current honest status
Implemented: ZIP/folder intake, vehicle metadata analysis, read-only PC YFT/YTD inspection, automatic local inspection during Vite development, target-profile record and fail-closed compatibility gates.

Not implemented: platform-neutral geometry/fragment IR, PS4 YFT/YTD encoders, complete dependency graph, exact-build PS4 round-trip validation, add-on vehicle packaging, bundled desktop installer, or PS4 deployment. The project must not present these as completed.


> Product scope note (2026-11-13): this vehicle-focused architecture is now a first-family implementation plan under the broader [Universal GTA V PC-to-PS4 mod-port architecture](UNIVERSAL-MOD-PORT-ARCHITECTURE.md). Shared IR, dependency and adapter principles must be generalized across resource families.
