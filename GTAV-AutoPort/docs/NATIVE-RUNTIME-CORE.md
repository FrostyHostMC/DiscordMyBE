# Native runtime core

## Portable action dispatcher

`native-runtime/` now defines a host-independent C++17 action contract for common mod behavior: entity spawn, transforms, attachments, vehicle properties, wanted level, rewards, ped tasks, entity health and explosions. The dispatcher validates identifiers, finite transforms, ranges and required handles before forwarding an action to the `GameApi` host interface.

The portable core is compiled and tested in CI with a fake host. This proves the dispatcher contract and validation logic, not the game integration.

## What is still missing for PS4

The abstract `GameApi` must be implemented by a separate Orbis/GoldHEN adapter. That adapter needs supported PS4 SDK headers/toolchain, GTA V CUSA00419 / update 1.73 native-call mappings, safe model streaming and entity lifecycle handling, and validated hooks. No game addresses or native hashes are hardcoded in this portable layer.

The current output is a host-side runtime core, not a `.prx`/`.sprx`. It must not be installed as a GoldHEN plugin. PC ScriptHookV, .NET, NativeUI, Lua or Windows API behavior still needs to be translated into explicit `Action` sequences and backed by real PS4 host methods.