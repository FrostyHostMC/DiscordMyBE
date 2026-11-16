# ReShade intake and PS4 adaptation

## What AutoPort does
AutoPort statically inventories ReShade .fx, .fxh, HLSL and .ini files, lists techniques/uniforms/includes, flags missing includes and detects effect families such as bloom, tone mapping, sharpening, color adjustment, depth of field, ambient occlusion, screen-space reflections and ray-tracing/global-illumination effects.

It explicitly excludes Windows ReShade DLLs and add-on binaries from PS4 output. A ReShade preset INI is not itself a shader implementation. The analyzer does not compile HLSL, decompile binaries, inject shaders, or claim that a detected effect is portable.

## Adaptation rules
- Color grading, exposure, contrast, saturation/vibrance, some bloom and sharpening may have approximate equivalents in GTA V-native visual settings or a verified game shader patch.
- Depth-buffer effects, MXAO/SSAO, RTGI, screen-space reflections, temporal effects and depth of field depend on renderer inputs or hooks. They cannot be reproduced by copying an INI or dropping a PC DLL onto the console.
- Missing shader includes must be resolved from the original mod package before translation.
- A PS4 output must be tied to the exact title/build and use a validated PS4-native implementation. No package should be emitted while those requirements are unmet.

## DYNA Dynamic Reshade 1.0 — known requirements
The public mod page describes DYNA as requiring ReShade 5.2.2 or newer, Pascal Gilcher's RTGI, and NaturalVision Remastered. Its instructions additionally require Timecycle Modifier 7 and the NoPedLights choice through Simple Trainer. These are material dependencies, not optional installation hints.

Source: https://www.gta5-mods.com/misc/dyna-dynamic-reshade

This means DYNA is not a standalone color preset:
- ReShade 5.2.2 and its Windows injector/add-ons cannot run natively on PS4.
- RTGI is a renderer-level effect and cannot be assumed to map to a native PS4 post-process.
- NaturalVision Remastered is a separate PC visual overhaul; relevant timecycle/weather/visualsettings resources must be independently identified and converted for the exact PS4 build.
- The Simple Trainer instruction is a runtime setting request, not a PS4 install file. A PS4-native equivalent must be identified and validated.

The linked 7z archive could not be fetched by the current build environment. Its member list, shader source, preset values and bundled binaries have NOT been inspected. Do not mark DYNA converted based only on its web description.

## Current target status
Target: PS4 CUSA00419, GTA V 1.57, Story Mode. No verified DYNA-compatible PS4 shader loader or 1.57 renderer hook is currently available in this pipeline. The older public GFX loader in the Scaleform research is a different system and is not a ReShade shader injector.

Next step: import DYNA.7z into AutoPort (or provide its extracted contents) so the analyzer can inspect the real files and dependency closure. Only then can individual effects be mapped to supported PS4-native visual resources or explicitly marked non-portable. No fake install package or guessed destination paths should be generated.
