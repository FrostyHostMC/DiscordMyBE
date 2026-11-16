# Orbis RPF Builder executable capability inventory

## Source specimen

The user supplied `Orbis-RPF-Builder.zip`, containing:
- `ragebuilder_x64_0378.exe` (8,078,336 bytes)
- `archive_builder.lua`
- `Archive.rpf` (30,720 bytes)
- `archive_input/content.xml`
- `archive_input/common/data/handling.meta`
- `xg.dll`, `zlib.dll`, and `zlib1.dll`

The executable is a Windows x86-64 PE32+ console application (timestamp 2015-02-11). Its import table includes ordinary Windows file/process APIs. Static string inspection identifies a Lua 5.0.2 runtime and a broad set of registered RAGE functions. This is static inspection only; it is not a claim that the executable has been dynamically traced.

## Archive API strings found in the executable

The executable registers the following pack operations:
- `start_pack`
- `start_pack_zlib`
- `start_pack_xcompress`
- `start_uncompressed_pack`
- `add_to_pack`
- `add_to_pack_path`
- `save_pack`
- `close_pack`
- `mount_pack`
- `unmount_pack`
- `is_compressed)
- `extract_file_to_memory`

It also registers ZIP operations (`start_zip`, `start_uncompressed_zip`, `add_to_zip`, `save_zip`, `close_zip`, `mount_zip`, `unmount_zip`) and image mounting (`mount_image`).

The executable exposes platform helpers:
- `set_platform` / `get_platform`
- `convert_filename_to_platform`
- `get_platform_extension`
- `find_platform_files)

Static strings include platform path tokens for `ps3`, `xbox360`, `ps4`, `durango`, `x64`, `pc`, and an internal `:orbis` platform token. This confirms that platform-aware filename resolution exists; it does not, by itself, reveal every mapping rule.

## Wider RAGE asset compiler surface

The same executable registers many load/save functions beyond archive packing, including:
- Models and dictionaries: `load_model(s)`, `save_model`, `save_model_dictionary`
- Fragments: `load_fragment`, `save_fragment`
- Textures: `load_texture(s)`, `save_texture`, `save_texture_dictionary`, `convert_and_save_dds`
- Animations/clips: `load_anim(s)`, `save_anim`, `compress_anim`, `anim_combine`, `load_clip(s)`, `save_clip_dictionary`
- Bounds/collision: `load_bound(s)`, `save_bound`, `save_bound_dictionary`
- Navigation: `load_navmesh`, `save_navmesh`, `load_pathregion`, `save_pathregion`, `load_hierarchicalnav`, `save_hierarchicalnav`, `load_heightmesh`, `save_heightmesh`
- Map/placement data: `load_placements`, `save_placements`, `save_mapdata`, `save_maptypes`, `save_occ_imap`, `save_occ_xml`
- Metadata and serialized formats: `load_meta`, `load_script`, `save_script`, `save_pso`, `save_pso_as`, `save_rbf`, `save_imf`, `save_cutfile`, `save_textdatabase`

This is why the long-term replacement should be a native format/compiler pipeline, not only an RPF wrapper.

## Supplied Lua recipe

The sample recipe calls:
`set_platform("orbis")`, `start_uncompressed_pack()`, two `add_to_pack` operations for `content.xml` and `common/data/handling.meta`, then `save_pack` and `close_pack`.

The helper function derives the source path from `archive_input/<folder>/<filename>` and the archive path from `<folder>/<filename>`. This establishes the sample's path-preservation behavior.

## What the output archive actually shows

The supplied 30,720-byte `Archive.rpf` begins with:
- bytes `37 46 50 52` (RPF7 magic in little-endian byte order)
- entry count `5`
- name-table length `48`
- fourth header word bytes `FF FF FE 0F` (little-endian integer `0x0FFEFFFF`)

The TOC/name region immediately after the header is not plaintext. The observed fourth word differs from the common PC OPEN/AES/NG marker values in public RPF7 references. Therefore AutoPort must not treat it as a standard OPEN archive or invent a matching marker. The supplied specimen does not, by itself, disclose the cipher, key derivation, platform-specific resource page encoding, or compression details.

## Implementation status

- **Implemented in AutoPort:** standard PC RPF7 OPEN writer foundation, with stored payloads, 512-byte block alignment, directory/file TOC construction, traversal/collision checks, and a refusal to mislabel RSC7 resources as generic binary entries.
- **Not implemented:** exact Orbis archive encryption/TOC encoding, Orbis resource page flags, XCompress writer, and full parity with the RAGE compiler's model/texture/animation/map serializers.
- **Do not label PC OPEN output as PS4-ready.** The Orbis writer remains gated on recovering and validating the exact platform encoding against known-good PS4 archives for the user's target build.

## Next reverse-engineering targets

1. Compare the supplied sample against known-good PS4 1.57 RPFs from the user's own installation.
2. Determine whether the Orbis marker is a distinct TOC cipher or an alternate serialization of the standard RPF7 tables.
3. Trace the executable's platform-specific pack initialization and save path (especially `set_platform("orbis")` plus `start_uncompressed_pack`).
4. Build a byte-exact round-trip fixture before enabling any Orbis write path.
5. Reimplement compression and format serializers independently and test each output against the reference executable's output.
