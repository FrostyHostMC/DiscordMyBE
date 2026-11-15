# PC script behavior recreation

## Source behavior blueprint

AutoPort now scans readable `.cs`, `.lua` and `.js` source files for common GTA behavior calls and framework dependencies. It groups evidence into behavior areas such as vehicle/ped/object spawning, transforms, ped tasks, wanted level/police response, rewards, weapons, health, explosions, blips, scheduler waits, controller input and interior navigation.

The exported blueprint lists each source file, matched API tokens and small source excerpts, detected behavior types, PC dependencies, and the host API surface a native implementation would need.

## What it cannot do

- A compiled `.dll` or `.asi` is not source code. The blueprint intentionally does not pretend it can recover full program logic from an opaque binary.
- Pattern matches are not full control-flow analysis. They identify evidence for a developer to inspect; they do not prove that a feature is fully understood.
- ScriptHookV, ScriptHookVDotNet, NativeUI, Windows APIs and .NET services are not PS4 runtime APIs.
- The blueprint is not compiled into an Orbis PRX and does not include GTA V 1.73 memory addresses, offsets or hooks.

## Native runtime completion requirements

To turn a blueprint into working PS4 gameplay, each behavior needs a tested implementation against a documented native host interface: entity creation, model streaming, transforms, ped tasks, wanted/police state, rewards, weapons, effects, input, scheduling and cleanup. Each call must be verified against the exact CUSA00419 / 1.73 build; unsupported actions must fail safely.

An Orbis SDK/toolchain, source code or a precise behavior specification, and a safe way to validate on the target console are required before building and signing a real plugin. The current output is a behavior blueprint only.