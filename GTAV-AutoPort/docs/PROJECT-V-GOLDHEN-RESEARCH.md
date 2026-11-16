# Project V and GoldHEN plugin research

## Finding

The PS4 GTA V modding path is not limited to rebuilding the whole game update. There is an existing community workflow using **Project V**, a GoldHEN plugin, alongside GoldHEN's plugin loader and (for file replacement) Application File Redirector (AFR).

A verified Modded Warfare video published 2023-08-03 describes Project V as allowing **some** PC GTA V mods to be used on PS4. Its description links this exact Project V v1.2 archive:
- https://www.mediafire.com/file/fc176msw53aamnc/ProjectV_Plugin_v1.2.zip

The video lists examples including No Water, Wanted Level Density, Realistic Emergency Lights, Motion Blur, Euphoria Ragdoll Overhaul, and Online Cars Spawn Naturally in Traffic. This is evidence of a supported subset and an existing runtime/plugin route, not proof that arbitrary PC mods or PC binaries run unchanged.

## GoldHEN plugin repository

Official repository:
- https://github.com/GoldHEN/GoldHEN_Plugins_Repository
- Releases: https://github.com/GoldHEN/GoldHEN_Plugins_Repository/releases

The repository documents:
- GoldHEN 2.3+ plugin loading (subject to firmware/GoldHEN compatibility).
- Plugins are native PS4 PRX modules, written in C/C++, able to hook games before boot and modify system/game functions.
- Plugins are installed under `/data/GoldHEN/plugins/` and enabled through `/data/GoldHEN/plugins.ini`, with per-title sections recommended.
- AFR (`afr.prx`) redirects file calls to a title-specific overlay under `/data/GoldHEN/AFR/<TITLE_ID>/`. Example: a game request for `/app0/hello_afr.txt` can be served from the matching AFR overlay path.
- Current release metadata includes a 1.210 pre-release (2025-06-16) and a 1.188 release (2023-05-27). Release versions are plugin-repository versions, not GTA V game versions.

## What this changes in AutoPort

AutoPort should have two distinct output strategies rather than treating every mod as a full RPF rebuild:

1. **Project V-compatible data mods**: identify the exact supported mod data/config/resource conventions and generate a Project V package/manifest where the mod is within the plugin's supported feature set.
2. **AFR file overlays**: stage target-native replacement files at the exact requested game paths, only when the game's file access and archive/container behavior is verified for the target title/build.
3. **Native PS4 plugin work**: for behavior that needs runtime code, require a PS4 PRX adapter or a Project V-supported feature. Windows ASI/DLL/ScriptHookV binaries are not directly executable on PS4.

Do not assume Project V handles vehicle DLC archives, arbitrary YFT/YTD conversion, or the Skyline `dlc.rpf` simply because it supports some PC mods. Vehicle asset conversion remains a separate engineering track until the plugin's actual supported input format and examples are inspected.

## Evidence and limitations

- The MediaFire ZIP itself was not downloaded or inspected in this research pass. Do not claim its internal files, supported version list, or exact configuration format are known yet.
- The Modded Warfare video and its description provide the Project V feature claim and named example mods.
- Official GoldHEN docs establish the PRX plugin loader and AFR mechanism, not the internal capabilities of Project V.
- Community reports describe some Project V mods being version-sensitive. Treat GTA V update compatibility as per-build, not universal.
- User's target is CUSA00419 (US), GTA V 1.57, PS4 firmware 14.00, GoldHEN 2.4b18.13 (user-provided; not independently validated). No compatibility claim is made for that combination.

## Next implementation work

- Obtain a trusted copy of Project V v1.2 from the user or another accessible source and inspect archive contents statically; never execute it on the development host.
- Extract documented file conventions and build a read-only Project V mod classifier.
- Add a capability matrix that distinguishes Project V-supported mods, AFR-compatible file overlays, PS4-native PRX requirements, and unsupported PC runtime plugins.
- Add a compatibility profile for the exact game CUSA/build and do not label a mod installable until a matching example/reference has been validated.
- Prioritize a known Project V-supported simple mod (e.g. a data/config or texture replacement) as the first end-to-end PS4 experiment before attempting vehicle DLC conversion.


## PS4 GTA V GFX Loader research (1.46)

The user supplied a PSXHAX thread covering a PS4 GTA V 1.46 GFX Loader ELF and Project V versions 1.0–1.3.1. The thread's linked public source repository is:
- https://github.com/rfoodxmodz/PS4-GTAV-GFX-LOADER

Static source inspection confirms this is a **narrow runtime file-redirection hook**, not a general graphics-mod engine:
- The repository README explicitly labels the project **Grand Theft Auto V - 1.46** and states its goal is to load GFX files from the PS4 filesystem, with `/data/font_lib_efigs_ps4.gfx` as the example.
- `main.cpp` patches a hard-coded GTA V function at offset `0x20D0F80` from base `0x400000`, with a byte signature explicitly commented `sub_20D0F80 1.46`.
- `hooks.cpp` intercepts requests whose path contains `font_lib_efigs` and redirects that request to `/data/font_lib_efigs_ps4.gfx`; other paths pass through unchanged.
- The release is an ELF named `GFX_LOADER.elf`, published 2023-07-06. Its release notes say to inject it before or at the beginning of the intro using the linked ELF Injector.

**AutoPort implications:** this is useful proof of a PS4-side hook pattern for one specific GFX asset path, and a concrete example of a native runtime adapter that could be generalized only after per-build analysis. It is not evidence that arbitrary PC graphics packs, ReShade/ENB shaders, arbitrary `.gfx` files, or GTA V 1.57 are supported. The hard-coded address and signature are build-specific; blindly applying this 1.46 ELF to 1.57 risks a crash or memory corruption.

Keep this project as a research reference, not a bundled binary or deployable adapter. A future AutoPort GFX adapter should identify the target build, resolve/verify the relevant function signature and file-open call, validate the replacement asset format, and fail closed when any check does not match. Do not reuse the 1.46 address on the user's CUSA00419 / GTA V 1.57 target without independent executable-level validation.

Sources:
- Repository and README: https://github.com/rfoodxmodz/PS4-GTAV-GFX-LOADER
- Release: https://github.com/rfoodxmodz/PS4-GTAV-GFX-LOADER/releases/tag/ps4-gtav
- User-supplied PSXHAX discussion: https://www.psxhax.com/threads/ps4-gtav-1-46-gfx-loader-elf-ps4-gta-v-projectv-v1-0-v1-1-v1-2-v1-3-1-by-rf0odxm0dz.15947/
