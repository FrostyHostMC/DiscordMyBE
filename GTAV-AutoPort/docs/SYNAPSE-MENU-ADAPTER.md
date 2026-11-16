# Synapse menu audit and AutoPort adapter

## Supplied menu package audit

The inspected `synapse.zip` contains a `plugins.ini` with a `[CUSA00419]` section loading `LSOPlugin.prx` and `synapse.sprx` from `/data/GoldHEN/plugins/`. It also contains two other title sections (`CUSA57548` and `CUSA07669`); these are separate plugin entries and are not evidence of GTA V support.

The Synapse data directory contains these catalogs:

| Catalog | Entries | Categories |
|---|---:|---:|
| vehicles.json | 812 | 20 |
| models.json | 275 | 7 |
| objects.json | 172 | 13 |
| particles.json | 197 | list |
| animations.json | 204 | list |
| scenarios.json | 134 | list |
| teleports.json | 0 | empty placeholder |

There are 1,794 populated catalog entries in total. The inspected JSON catalogs have no duplicate values. The zero-byte `teleports.json` is an empty placeholder, not malformed JSON.

The supplied `settings.ini` defines menu position, information box, side placement, open/noclip button combinations, rainbow theme, ESP RGB values, god mode and no-ragdoll defaults.

The separately supplied `synapse.sprx` begins with bytes `4f 15 3d 1d`, the PlayStation SELF container signature. This identifies the container signature only; it does not prove that the executable is valid, disclose its internal implementation, or establish compatibility with GTA V 1.57.

## Findings and required menu work

1. **GoldHEN plugin configuration exists.** GoldHEN is already configured to load the menu PRX for CUSA00419. AutoPort should not invent a second plugin-loading system.
2. **Synapse data is catalog-driven in the supplied package.** Vehicles, models, objects, particles, animations and scenarios are represented as JSON catalogs.
3. **No XML examples or XML loader contract were supplied.** The `xml/` folder has no files. The package does not include Synapse source code. AutoPort therefore cannot safely claim that Menyoo/Spooner XML is directly loadable by this menu.
4. **The menu binary is compiled.** AutoPort inventories its header and data package but does not patch or rewrite the SPRX.

## AutoPort changes

`src/core/menuPack.js` now:
- inventories catalog shape, categories, entries and duplicate values;
- treats zero-byte JSON files as empty placeholders rather than invalid JSON;
- parses the menu's INI settings and title-specific GoldHEN plugin configuration;
- recognizes the PS4 SELF header signature without claiming executable validation;
- inspects vehicle XML as a source format and keeps target-menu compatibility explicitly unverified.

The import workbench shows catalog counts, settings, all title-specific plugin entries, SPRX header classification and XML findings. It can export the complete inspection report.

## Menyoo vehicle export handoff

The workbench now exports `autoport-menyoo-vehicle-pack` JSON with the original placement subtree, model hashes/names, transforms, attachments and vehicle property nodes preserved. This is an AutoPort interchange format only. It must not be copied into `synapse/files/xml` or renamed to `vehicles.json`: the supplied Synapse archive had an empty XML folder and no documented XML loader schema. A real menu adapter must define and implement the pack schema, vehicle spawn, transforms, property setters, attachment/bone handling and cleanup.

## Safe next step for a real menu update

To add a real XML loader to Synapse, we need its editable source project or a documented extension interface. The correct implementation belongs inside the menu/runtime: parse a defined XML schema, validate values, and dispatch supported game-native actions. AutoPort can then generate that schema from imported mods. Without the source or a tested interface, changing catalog JSON or renaming XML files would not add XML execution support.

## Compatibility policy

No PRX or XML pack is marked compatible with CUSA00419 update 1.57 until the exact menu binary, GoldHEN loading, title/update identity and on-console test evidence are recorded. PC ASI/DLL binaries must never be copied into the PS4 plugin list.
## Script-mod intake and Home Invasion-style behavior

`src/core/scriptModPackages.js` groups runtime files with XML/INI/JSON configuration in the same folder. It identifies PC runtime inputs (`.asi`, `.dll`, `.cs`, `.lua`, `.js`) separately from console plugin candidates (`.prx`, `.sprx`) and parses XML configuration signals such as house/location entries, HomeType fields, coordinates, markers, alert/police settings, masks, rewards and resident/ped settings.

The Home Invasion 2.0 example is a useful behavior-porting test: its PC package pairs a .NET DLL with an XML configuration. AutoPort can inspect the configuration and inventory the DLL, but cannot translate the DLL into a GoldHEN plugin automatically. Gameplay such as interior entry, resident AI, detection, police dispatch and robbery rewards requires a separate PS4-native implementation. XML fields are data candidates only; they do not execute those behaviors.

This analyzer is an intake/reporting stage, not an XML exporter or PRX compiler. A real native plugin still needs editable implementation source, a documented runtime interface, Orbis build tooling, and exact GTA V CUSA00419 / 1.57 validation.
