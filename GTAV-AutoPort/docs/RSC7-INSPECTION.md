# RSC7 and native resource inspection

## Browser-side header inspection

The browser workbench reads the 16-byte RSC7 header and records the magic, little-endian version, system page flags, graphics page flags, and payload length. It compares the version only with the observed values in the supplied Glendale PC fixture:
- YFT version 162.
- YTD version 13.

A matching version is only a fixture comparison. It is not a platform or compatibility detector. Page flags are not yet decoded or validated by the browser inspector.

## Native Rust parser

The native adapter uses [VIRUXE/rage-formats](https://github.com/VIRUXE/rage-formats), distributed under the Unlicense, to parse RAGE resources:
- YFT fragment: main drawable, extra drawables, LODs, models, geometry, triangle counts, bone transforms, and physics children.
- YTD texture dictionary: texture names, dimensions, formats, mip counts, and DDS extraction.

This parser provides structural inspection that a magic-byte check cannot. It does not mean the resource is compatible with PS4, and it does not rewrite YFT assets.

## Crown Victoria fixture observations

The supplied Glendale assets were previously inspected:
- `glendale.yft`: RSC7, version 162.
- `glendale_hi.yft`: RSC7, version 162.
- `glendale.ytd`: RSC7, version 13.

These values are recorded as PC fixture observations only. The native parser has not yet been run against the actual Crown Victoria binaries in this development environment because Rust/Cargo are unavailable here. GitHub Actions now builds and tests the adapter, but that does not replace a fixture-specific parser run.

## Next technical gate

Run the native parser against the actual Glendale YFT/YTD fixture on a Rust-enabled machine. Then compare parsed structures with verified PS4 retail resources for the exact GTA V title ID and build. Only after the differences are understood should a PS4-specific writer/converter be implemented.
