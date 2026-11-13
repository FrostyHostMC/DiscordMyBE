# RSC7 resource inspection

AutoPort's current inspector reads the 16-byte RSC7 header only. It validates the magic bytes and records the little-endian version, system page flags, graphics page flags, and payload length.

Known version hints currently covered:
- YFT: legacy 162; Enhanced 171.
- YTD: legacy 13; Enhanced 5.
- YDR/YDD: legacy 165; Enhanced 159.

These are format-generation hints, not a platform detector. The RSC7 signature does not establish that a file is compatible with PS4. The inspector does not yet decompress the payload, resolve virtual pointers, parse geometry/physics, decode textures, or rewrite resources.

## Crown Victoria fixture observations

The supplied Glendale assets were previously inspected:
- `glendale.yft`: RSC7, version 162.
- `glendale_hi.yft`: RSC7, version 162.
- `glendale.ytd`: RSC7, version 13.

This confirms that the fixture contains recognized GTA V Legacy-generation RSC7 resources. It does not prove PS4 compatibility.

## Research references

- [VIRUXE/rage-formats](https://github.com/VIRUXE/rage-formats) — documents the 16-byte RSC7 container and read-only parsers for YFT/YTD and related resources.
- [RAGE resource format notes](https://blancodagoat.dev/gtav-rage-formats/resources/) — describes resource versions, page flags, and virtual pointer segments.

## Next technical gate

Implement bounded RSC7 decompression and validate system/graphics segment sizes before any pointer traversal. Then parse YTD textures and YFT fragment structure using a maintained, licensed parser implementation. No conversion output should be produced until a real PS4-target writer and game-build tests exist.
