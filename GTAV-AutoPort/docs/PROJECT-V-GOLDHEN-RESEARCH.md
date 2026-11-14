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
- User's target remains CUSA00411, GTA V 1.73, PS4 firmware 14.00, GoldHEN 2.4b18.13 (user-provided; not independently validated). No compatibility claim is made for that combination.

## Next implementation work

- Obtain a trusted copy of Project V v1.2 from the user or another accessible source and inspect archive contents statically; never execute it on the development host.
- Extract documented file conventions and build a read-only Project V mod classifier.
- Add a capability matrix that distinguishes Project V-supported mods, AFR-compatible file overlays, PS4-native PRX requirements, and unsupported PC runtime plugins.
- Add a compatibility profile for the exact game CUSA/build and do not label a mod installable until a matching example/reference has been validated.
- Prioritize a known Project V-supported simple mod (e.g. a data/config or texture replacement) as the first end-to-end PS4 experiment before attempting vehicle DLC conversion.
