# Experimental PS4 BC texture storage adapter

## What AutoPort now does

The new ps4TextureLayout.js module adds a bounded first-stage PS4 texture storage conversion path:

1. Reads DDS headers and validates header sizes, dimensions, mip counts, texture shape and payload bounds.
2. Recognizes legacy DXT1/BC1, DXT5/BC3 and ATI2/BC5, plus matching DX10 BC1/BC3/BC5 DXGI formats.
3. Computes per-mip 4x4 compression-block extents and reports whether the supplied DDS contains the full possible mip chain; it never invents missing mip levels.
4. Reorders BC blocks into the PS4 Legacy Thin1DThin 8x8 microtile storage layout (tile mode 0x800001, tile index 13).
5. Untiles the generated allocation and compares every byte with the source mip payload.
6. Writes the storage payload and a JSON sidecar into ps4-texture-storage-candidates/ in the automatic prep ZIP. The sidecar records adapter ID/version, requested title/update, source/output SHA-256, mip completeness, layout metadata and warnings.

The prep manifest and delivery plan call this a partial conversion, never a PS4-ready resource. Unsupported DDS files remain preserved and receive a reason in reports/ps4-texture-storage.json.

## Hard boundary

This is not a complete GTA V YTD writer. It does not yet:
- encode PNG/JPEG/uncompressed source images into BC formats;
- build the RSC7 resource header, texture dictionary object graph, texture object metadata or mip views;
- preserve or generate all game-specific texture names, sampler metadata and references;
- insert the result into a verified PS4 RPF;
- prove the allocation layout against CUSA00419 retail texture fixtures or an on-console render.

The generated .ps4tex.bin is a raw tiled allocation candidate, not a .ytd, .otd, .rpf or installable package. ps4ReadyFiles remains zero.

## Safety and limits

- Maximum dimension: 16,384 pixels per axis.
- Maximum mip count: 16 and no more than the mathematical dimension chain.
- Maximum single texture storage allocation: 64 MiB.
- Maximum inspected compressed blocks: 4,194,304.
- Only ordinary single-slice 2D BC1/BC3/BC5 textures are accepted.
- Cubemaps, volume textures, arrays, truncated payloads and unsupported formats are rejected.
- Original DDS bytes remain in source-original/.

## Validation status

Unit tests cover header validation, legacy and DX10 format detection, bounds, supported formats, microtile round trips and automatic prep-bundle export. These are software tests using generated fixtures. They do not prove hardware output or game compatibility. The exact target remains CUSA00419 / GTA V 1.57, and target resource compatibility is unverified.

## Research references

- PS4 target profile and resource-check implementation: https://github.com/RaringM/ps5-gtav-menu/blob/main/tools/gtavmenu_tools/ps4_resource_checks.py
- PS4 Thin1DThin texture writer: https://github.com/RaringM/ps5-gtav-menu/blob/main/tools/gtavmenu_tools/ps4_texture_writer.py
- PS4 plugin target manifest (CUSA00411 / 01.57, not the user's CUSA00419 build): https://github.com/RaringM/ps5-gtav-menu/blob/main/data/targets/ps4/cusa00411-01.57.json

The reference repository is MIT-licensed overall but also documents third-party data/provenance constraints. AutoPort's implementation is a bounded independent storage-layout adapter; no upstream PS4 plugin, executable, game asset, or CodeWalker binary is bundled.
