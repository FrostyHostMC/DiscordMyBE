# Synapse / GoldHEN menu adapter

## Evidence from the supplied Synapse package

The user-provided archive contains a `plugins.ini` with a `[CUSA00419]` section loading `LSOPlugin.prx` and `synapse.sprx` from `/data/GoldHEN/plugins/`. Its menu data is organized under `synapse/synapse/files/` and includes JSON catalogs for vehicles, models, objects, particles, animations and scenarios, plus `settings.ini`. The included `xml/` directory is empty.

This establishes that GoldHEN is configured to load the menu's native plugin for the specified title ID. It does not establish the binary's update compatibility, the menu's XML parser contract, or that arbitrary Menyoo XML can be loaded.

## Division of responsibility

- GoldHEN loads per-title native PRX/SPRX plugins.
- Synapse is the menu/runtime that implements menu actions and decides which data formats it understands.
- AutoPort analyzes imported mods, maps supported content into a menu adapter, and separately plans native PS4 behavior where feasible.

GoldHEN's plugin loader is not itself a universal mod-menu data parser. The menu's PRX must implement the parsing and runtime behavior.

## AutoPort implementation

`src/core/menuPack.js` inventories Synapse-style JSON catalogs, counts their categories and entries, reads title-specific GoldHEN plugin entries, identifies the Synapse SPRX by filename, and inspects vehicle XML. Menyoo/Spooner XML is identified as a source format and reports model hashes and attachment/task-sequence nodes. The workbench can export the report.

The parser deliberately does not label Menyoo XML as Synapse-compatible. The supplied Synapse archive has no XML examples or source code. To implement a real menu-side XML extension, the Synapse source project or a documented/tested XML schema is required.

## Compatibility policy

No PRX or XML pack is marked compatible with CUSA00419 update 1.73 until the exact menu binary, GoldHEN loading, title/update identity and on-console test evidence are recorded. PC ASI/DLL binaries must never be copied into the PS4 plugin list.
