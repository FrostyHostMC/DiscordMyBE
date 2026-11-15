# AutoPort GoldHEN Runtime Architecture

## Goal

Build one native GoldHEN PRX runtime for the user's confirmed US GTA V target, **CUSA00419 / reported update 1.73 / Story Mode**. AutoPort converts and packages supported mod content into a documented data format; the runtime loads that data and implements supported behavior inside the game.

This is a runtime architecture, not a promise that arbitrary PC mods can be executed unchanged.

## Why one runtime is better than one plugin per mod

GoldHEN loads native PS4 plugins (PRX) into a title process. A single AutoPort runtime can own:
- startup/build identification and fail-closed compatibility checks;
- a mod manifest and dependency resolver;
- file/resource redirection where the game and loader support it;
- asset pack discovery and validation;
- native feature adapters for specific game systems;
- logging, crash-safe disable switches, and per-mod enable/disable settings.

Individual mods should normally be **data packs** plus optional AutoPort feature modules, not independently compiled PRX files. The runtime can load data and dispatch supported features. A mod that requires a new engine hook or behavior may still need a new native adapter.

## GoldHEN installation contract

GoldHEN's documented plugin layout is:
- PRX: `/data/GoldHEN/plugins/AutoPortRuntime.prx`
- plugin config: `/data/GoldHEN/plugins.ini`
- game-specific section: `[CUSA00419]`
- entry: `/data/GoldHEN/plugins/AutoPortRuntime.prx=true`

Keep the entry under the CUSA00419 section, not `[default]`, so it is not injected into unrelated titles. The GoldHEN Plugin Loader must be enabled. Preserve existing entries and back up `plugins.ini` before edits.

A PRX file is a compiled PS4-native module. A Windows DLL/ASI/EXE, JavaScript plugin used by the AutoPort desktop app, or ordinary ZIP is not a GoldHEN plugin and cannot be renamed to .prx.

## Runtime and pack layout proposal

The runtime should read only a bounded, versioned manifest and data files from a dedicated AutoPort directory. Proposed layout (subject to a verified file-access strategy):

```text
/data/GoldHEN/plugins/AutoPortRuntime.prx
/data/GoldHEN/plugins.ini
/data/AutoPort/CUSA00419/
  runtime.json
  packs/
    <pack-id>/
      manifest.json
      assets/
      scripts/
  logs/
    runtime.log
```

The directory is a proposal, not a claim that GTA V currently reads it. The PRX must implement the file access and resource integration. AFR is a possible reference for redirecting game file reads from `/data/GoldHEN/AFR/CUSA00419/`, but AFR alone does not parse PC assets, register new GTA resources, or implement mod behavior.

### Manifest contract (draft)

Each pack manifest should include:
- schema version and unique pack ID;
- display name, author, license/provenance, and pack version;
- minimum/maximum supported AutoPort runtime API;
- exact supported title ID and game update range;
- required feature adapters and dependencies;
- file list with relative paths, byte sizes, and SHA-256 hashes;
- asset types and declared resource identifiers;
- explicit unsupported features and conversion warnings.

Reject path traversal, absolute paths, duplicate IDs, oversized files, unknown schema versions, missing dependencies, hash mismatches, and target-build mismatches. Do not load executable code from an untrusted mod pack.

## Compatibility boundaries

A generic loader cannot make all PC mods work:
- **Textures/models/vehicles/peds/maps:** require conversion to the PS4 GTA resource formats and a verified way to register or replace resources in the target game build.
- **Scripts and trainers:** PC ASI, ScriptHookV, .NET and Windows DLL code cannot run on PS4. Each supported behavior must be reimplemented in native PS4 code or a deliberately restricted, sandboxed data-driven scripting VM.
- **Graphics/ReShade effects:** require PS4 renderer hooks and equivalent shader implementations; copying shader files is not enough.
- **Native game hooks:** require exact CUSA00419 1.73 executable identity, ABI, addresses/signatures, and runtime validation. Never reuse 1.57 offsets because the menu happens to work.
- **Online:** out of scope; target Story Mode only.

## Fail-closed build identity

Before enabling game hooks or loading packs, the runtime must identify the running title and game build using reliable runtime evidence. If the title ID, update, executable fingerprint, or required adapter is unknown, it must disable game modifications and write a diagnostic log. A matching title ID alone is not enough to prove update compatibility.

The user's report that certain 1.57 menus work on their 1.73 game is a lead for testing those exact binaries/features. It is not evidence that unrelated 1.57 hooks, offsets, resource packs, or assets are compatible.

## Development phases

1. **PRX hello-world:** build a minimal native PS4 PRX with the supported Orbis toolchain, load only for CUSA00419, emit a startup log, and provide a safe disable path. No game hooks yet.
2. **Runtime identity:** identify title/build, log runtime capabilities, and fail closed on unknown builds.
3. **Pack reader:** parse and validate manifests, hashes, dependencies and path safety without changing game resources.
4. **Read-only file experiment:** verify a known harmless test file can be read from the chosen data directory; compare direct file access and AFR redirection. No asset replacement yet.
5. **First resource adapter:** select one low-risk resource type and prove it can be registered/replaced on CUSA00419 1.73 using matching build evidence.
6. **Feature adapters:** implement selected script/menu behaviors in native code, one feature at a time, with automated unit tests and on-console logs.
7. **Installer/export:** produce a PRX plus manifest/data packs and a generated CUSA00419 plugins.ini snippet. Never overwrite the user's existing plugin configuration silently.

## Toolchain and release gates

The current `native-engine` CMake target builds the desktop RageKit CLI; it does **not** build an Orbis PRX. Do not present its output as a GoldHEN plugin.

A PRX release is blocked until the repository has:
- a legally obtained PS4 SDK/toolchain and documented reproducible build environment;
- a minimal PRX entry point that links for the intended PS4 environment;
- a CUSA00419-only plugin configuration;
- static validation of PRX format/imports and dependency list;
- a startup log and safe failure behavior;
- evidence from the exact target game build;
- an on-console test showing the plugin loads without crashing Story Mode.

No compiled PRX or installable package is claimed by this architecture document.

## Public references

- GoldHEN plugin repository and installation layout: https://github.com/GoldHEN/GoldHEN_Plugins_Repository
- GTA V Lotus GoldHEN PRX example for CUSA00419 (its README calls for old updates 1.27/1.48; research reference only, not a 1.73 binary): https://github.com/illusionyy/PS4-GTAV-Lotus-SPRX-Release
- GoldHEN plugin documentation lists native C/C++ game hooks and per-title plugin sections: https://github.com/GoldHEN/GoldHEN_Plugins_Repository
- AFR file redirector reference: https://github.com/GoldHEN/GoldHEN_Plugins_Repository

These references establish the GoldHEN plugin mechanism, not compatibility of any existing plugin with CUSA00419 update 1.73.
