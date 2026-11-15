# Native runtime core

## Portable action dispatcher

`native-runtime/` now defines a host-independent C++17 action contract for common mod behavior: entity spawn, transforms, attachments, vehicle properties, wanted level, rewards, ped tasks, entity health and explosions. The dispatcher validates identifiers, finite transforms, ranges and required handles before forwarding an action to the `GameApi` host interface.

The portable core is compiled and tested in CI with a fake host. This proves the dispatcher contract and validation logic, not the game integration.

## What is still missing for PS4

The abstract `GameApi` must be implemented by a separate Orbis/GoldHEN adapter. That adapter needs supported PS4 SDK headers/toolchain, GTA V CUSA00419 / update 1.73 native-call mappings, safe model streaming and entity lifecycle handling, and validated hooks. No game addresses or native hashes are hardcoded in this portable layer.

The current output is a host-side runtime core, not a `.prx`/`.sprx`. It must not be installed as a GoldHEN plugin. PC ScriptHookV, .NET, NativeUI, Lua or Windows API behavior still needs to be translated into explicit `Action` sequences and backed by real PS4 host methods.
## Executing compiled action plans

`src/core/nativeActionPlan.js` now compiles supported Menyoo vehicle data into a deterministic action sequence: spawn the vehicle, apply a known transform, spawn attachment objects, attach them using explicit bone/offset/rotation data, and apply only allowlisted numeric vehicle properties. Missing transforms and incomplete attachment records become explicit blockers; unknown property values remain in `unsupportedProperties` instead of being guessed.

`native-runtime` now includes `PlanExecutor`, which resolves symbolic entity IDs returned by spawn actions into runtime handles before dispatching later transform, attachment and vehicle-property actions. The executor stops at the first failed action and exposes `clear()` for lifecycle cleanup. Its fake-host tests verify ordering and reference resolution.

The JSON plan is not yet loaded by the C++ layer and the fake host is not GTA V. A JSON parser/bridge, model streaming, cleanup on partial failure, and the CUSA00419/1.73 Orbis implementation remain necessary.