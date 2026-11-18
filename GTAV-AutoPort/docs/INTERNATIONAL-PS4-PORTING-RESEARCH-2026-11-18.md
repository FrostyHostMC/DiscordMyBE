# International PS4 GTA V Porting Research — 2026-11-18

## Scope and target boundary

This is a research-only update for GTAV AutoPort. The intended user target remains GTA V Story Mode, US title ID **CUSA00419**, update **1.57**, PS4 firmware **14.00**, GoldHEN **2.4b18.13** (user-supplied target details; not independently verified by this document).

The most useful public PS4 references found in this research primarily target EU **CUSA00411**. Their converters, PRX binaries, offsets, hooks, templates and package assumptions must not be treated as compatible with US CUSA00419 without separate evidence.

No upstream source code or third-party binaries are copied into AutoPort by this document. No PS4 resource writer, runtime hook, or installable output is claimed.

## 1. RaringM custom-pack conversion project

Reference: https://github.com/RaringM/ps5-gtav-menu

The project documents a PC-side converter/tooling ecosystem and a console plugin that consumes custom packs. Its documented converter families include vehicles and stock replacements, peds, clothing, weapons, wheels, maps/interiors, collision and props.

Important target-specific boundary: its documented PS4 1.57 custom-pack lane is substantially narrower than its broader converter/tool catalogue. The PS4 guide describes vehicle packs and stock replacements as supported, while maps, archetypes, collision, ped/clothing data, weapon components, custom wheels and mod kits are not accepted by that PS4 lane. Treat this as an upstream implementation limitation, not a permanent GTA V platform limitation.

The project documents PS4 resource extensions:
- PC YFT → PS4 OFT
- PC YTD → PS4 OTD
- PC YDR → PS4 ODR
- PC YDD → PS4 ODD

Its conversion workflow uses CodeWalker-related tooling and stock game templates. This suggests a valuable adapter/backend comparison for AutoPort, but it does not establish that RageKit can currently emit these formats. The exact conversion implementation, resource layouts, template requirements and validation behavior must be inspected before implementation.

The project's documented PS4 runtime target is EU CUSA00411 GTA V 1.57, tested in its guide on firmware 9.00 with GoldHEN. This is not proof for US CUSA00419, firmware 14.00, or GoldHEN 2.4b18.13.

Architectural lessons:
1. Separate source conversion tools from the in-game pack loader.
2. Use explicit manifests, pack validation and conflict checks.
3. Keep target-specific resource writers separate from PC Legacy/Enhanced writers.
4. Validate resource structure and dependencies, not just output file existence.
5. Keep unsupported asset families visibly blocked rather than silently packaging them.

## 2. GoldHEN and OpenOrbis native plugin route

References:
- GoldHEN Plugins SDK: https://github.com/GoldHEN/GoldHEN_Plugins_SDK
- OpenOrbis PS4 Toolchain: https://github.com/OpenOrbis/PS4-Toolchain
- GoldHEN plugin repository: https://github.com/GoldHEN/GoldHEN_Plugins_Repository

The official GoldHEN plugin SDK provides a native PRX hook/patch development route built around the OpenOrbis toolchain and LLVM. This supports the proposed AutoPort design of one shared native runtime plus versioned data packs and optional feature adapters.

The SDK is a toolchain/API foundation, not a turnkey GTA V 1.57 runtime. It does not make Windows ASI, DLL, EXE, ScriptHookV or .NET code executable on PS4. Exact title identity, ABI, native signatures, hooks, file access and game-build validation remain separate requirements.

## 3. InsulinGTAV native plugin reference

Reference: https://github.com/InsulinEngine/InsulinGTAV

The repository documents a CMake/OpenOrbis GoldHEN PRX project for GTA V EU CUSA00411 v1.57, with source, tests, tools and build scripts. It is useful for studying project layout, reproducible native builds, plugin entry points and test organization.

Boundary: this is EU CUSA00411 evidence. It is not a US CUSA00419 PRX, and its addresses, hooks, offsets, executable identity and binary must not be reused for the user's target without independent validation. It is also not evidence of a generic PC script transpiler.

## 4. Historical US CUSA00419 PRX precedent

Reference: https://github.com/illusionyy/PS4-GTAV-Lotus-SPRX-Release

The Lotus SPRX README documents a GoldHEN plugin configuration for US CUSA00419, but its stated GTA V versions are older (1.27 / 1.48). This establishes historical title-ID-specific plugin precedent only. It does not establish 1.57 compatibility, firmware 14.00 compatibility, or reusable offsets.

## 5. RageKit capabilities and script boundary

Reference: https://github.com/RatPrez/ragekit

RageKit is already integrated in AutoPort as the source-side native RAGE resource engine. Its public capability documentation covers a broad set of RAGE resources and archives, including RPF, models, textures, maps, audio and YSC structures.

Crucial distinction: structural YSC read/write support is not equivalent to a script decompiler, source-level reconstruction engine, compiler, or validated PS4 script loader. The upstream comparison notes a missing YSC disassembler and other typed-format gaps. AutoPort must not claim arbitrary PC script conversion from YSC parsing alone.

Before adding another backend, compare the exact RageKit version already pinned in AutoPort with the required PS4 output contract. Avoid duplicating a parser or writer unless a concrete, tested coverage gap is identified.

## 6. PC script framework implications

References:
- ScriptHookV: https://github.com/Give-Two/ScriptHookV
- ScriptHookVDotNet: https://github.com/scripthookvdotnet/scripthookvdotnet
- RAGE Plugin Hook: https://ragepluginhook.net/

PC script compatibility is not just native-hash translation. A usable replacement layer may need script lifecycle and scheduling, waits/tick callbacks, entity and pool enumeration, global state access, streaming/resource registration, input/menu services, persistence and native invocation.

ScriptHookVDotNet depends on a Windows ASI/API environment and .NET Framework. RAGE Plugin Hook is a separate PC plugin framework. Neither runtime should be assumed portable to PS4. The feasible approach is to extract behavior and rebuild supported features against AutoPort's shared PS4-native API.

## 7. Candidate AutoPort architecture

Keep these concerns separate:

- **Desktop intake and analysis:** archive safety, classification, dependency graph, source inspection and reports.
- **Source-side RAGE engine:** RageKit and other explicitly versioned parsers/writers.
- **PS4 asset adapters:** exact-target resource encoders and validators using lawful, user-owned target fixtures.
- **Shared behavior IR:** events, entities, tasks, state, menus, jobs, missions, persistence and resource references.
- **PS4 runtime:** one GoldHEN PRX with target identity checks, native services, scheduler, feature adapters, pack loader and diagnostics.
- **Pack format:** versioned manifest, dependencies, hashes, target IDs/builds, assets, data and supported behavior declarations.
- **Acceptance harness:** static format checks, unit tests, native build checks, then exact-target console tests with safe rollback.

Potential scripting VM approaches (for example, a deliberately restricted Lua runtime) remain research candidates until a loader is verified on CUSA00419 1.57. A GoldHEN PRX loader and a CSC/YSC script loader are distinct mechanisms and must not be conflated.

## 8. Next evidence gates

1. Inspect the current AutoPort ZIP and reconcile every feature with this research before changing implementation.
2. Verify the user's exact base/update PKG metadata and runtime title/build identity.
3. Obtain lawful, user-owned CUSA00419 1.57 reference resources for each proposed PS4 writer.
4. Determine whether CodeWalker conversion can be invoked as a pinned adapter or whether a separate writer is required.
5. Prove one benign CUSA00419 1.57 PRX loads and logs safely before adding hooks.
6. Prove a single low-risk PS4 resource replacement end-to-end before expanding asset families.
7. Build a script API coverage matrix and implement only behavior with a validated target runtime.
8. Keep all unverified families classified as assisted or unsupported; never label them converted.

## Research conclusion

The public references provide useful examples of PS4 custom-pack conversion, GoldHEN PRX build systems and historical CUSA00419 plugin configuration. They do not yet provide a verified universal PC-to-PS4 gameplay scripting bridge for the user's exact target. AutoPort's existing fail-closed compatibility gates remain appropriate.
