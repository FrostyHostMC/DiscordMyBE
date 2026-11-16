# Scaleform graphics intake and PS4 port status

## What AutoPort implements now

The graphics workbench recognizes these file families during ordinary ZIP/OIV/7z/folder import:

- `.gfx`: Scaleform GFx movie.
- `.swf`: Flash/Scaleform source movie.
- `.fla` and `.as`: authoring project and ActionScript source.
- `.ttf` and `.otf`: font source assets.

For GFX/SWF files, AutoPort reads the 8-byte container header, checks the known FWS/CWS/ZWS/GFX/CFX signatures, reads the SWF version and declared uncompressed length, and applies bounded sanity checks. It does not execute ActionScript, decompress the movie body, or claim that the movie is compatible with GTA V.

For a structurally plausible GFX/CFX file, the workbench can create a **separate editor-handoff copy** by changing only the 3-byte Scaleform signature to its corresponding SWF signature (GFX → FWS, CFX → CWS). The original file remains unchanged. This is an editor compatibility handoff, not a game-ready conversion.

## Editing and rebuilding

JPEXS Free Flash Decompiler documents support for Scaleform GFX/CFX files and can inspect/edit embedded images, shapes, text and ActionScript. A JPEXS project can be used to inspect a mod asset, but saving an edited SWF does not automatically make it a game-ready Scaleform GFX.

Autodesk Scaleform GFxExport is the legacy preprocessing tool used to turn SWF movies into optimized GFX files and extract/re-encode embedded image resources. It is a separate licensed/proprietary toolchain and is not bundled by AutoPort. Some PS4-specific texture conversion paths require Sony Orbis image tooling and appropriate platform SDK access. AutoPort must not claim that a PC DDS export or a renamed SWF is a PS4-compatible texture/movie.

Useful references:
- JPEXS feature overview: https://github.com/jindrapetrik/jpexs-decompiler/wiki/
- Scaleform GFxExport overview: https://help.autodesk.com/cloudhelp/ENU/Scaleform-Help/scaleform_help/gfxexport_reference.html
- GFxExport platform and image conversion options: https://help.autodesk.com/cloudhelp/ENU/Scaleform-Help/scaleform_help/gfxexport_reference/usage.html
- GTA V Scaleform authoring notes (ActionScript 2 / Flash Player 8 and GFxExport): https://docs.fivem.net/docs/scripting-manual/using-scaleform/

## Existing PS4 GFX loader: exact limitation

The public `rfoodxmodz/PS4-GTAV-GFX-LOADER` source explicitly targets GTA V **1.46**. Its `main.cpp` writes a 16-byte function prologue at `0x20D0F80 + 0x400000` and detours that address. The source comment labels the function `sub_20D0F80 1.46`. Its hook redirects requests containing `font_lib_efigs` to the single fixed path `/data/font_lib_efigs_ps4.gfx`; other paths are passed through unchanged.

That loader therefore demonstrates a narrow PS4 runtime hook for the GTA V font library. It does **not** load arbitrary GFX assets by path, and the 1.46 memory address/signature must not be injected into GTA V 1.57 without matching executable-level analysis.

Source:
- https://github.com/rfoodxmodz/PS4-GTAV-GFX-LOADER
- https://github.com/rfoodxmodz/PS4-GTAV-GFX-LOADER/blob/main/GTAV%20GFX/main.cpp
- https://github.com/rfoodxmodz/PS4-GTAV-GFX-LOADER/blob/main/GTAV%20GFX/hooks.cpp

## Current user target and honest status

Target supplied by user: CUSA00419, GTA V 1.57, PS4 firmware 14.00, GoldHEN 2.4b18.13, Story Mode.

- GFX/SWF identification and editor handoff: implemented.
- Scaleform movie-body parsing/decompilation: external JPEXS workflow, not integrated.
- Game-ready GFX export: requires compatible GFxExport toolchain and format/runtime checks.
- PS4-specific graphics texture conversion: not implemented; platform-specific tools and resource layout need verification.
- PS4 GFX file loading on GTA V 1.57: **not implemented or validated**.
- Installable graphics package for the user's target: **not available yet**.

## Next engineering milestone

Build a version-aware PS4 GFX loader adapter, not a blind reuse of the 1.46 ELF. It must be based on the user's exact 1.57 executable, resolve the target file-open function with a verified signature or symbol, reject ambiguous/missing matches, and support explicit per-file mappings rather than one hard-coded font path. Only after a matching build can be compiled and tested should AutoPort stage a 1.57 graphics mod for console installation.
