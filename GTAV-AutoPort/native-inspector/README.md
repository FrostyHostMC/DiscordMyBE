# Native YFT/YTD inspector

This read-only Rust command-line adapter uses the public-domain [VIRUXE/rage-formats](https://github.com/VIRUXE/rage-formats) crate (Unlicense) to inspect GTA V RSC7 resources.

## Build

Install Rust stable, then:

```bash
cargo test
cargo build --release
```

## Run

```bash
cargo run --release -- path/to/glendale.yft
cargo run --release -- path/to/glendale.ytd
cargo run --release -- path/to/asset.ytd path/to/output-folder
```

For the supplied Glendale pair, run both commands with the same basename and parent directory so both reports land in the same `glendale-autoport-inspection` folder:

```bash
cargo run --release -- /path/to/glendale.yft
cargo run --release -- /path/to/glendale.ytd
```

Then open AutoPort and choose **Load native reports**, selecting that output folder. The dashboard imports the JSON reports and any PNG previews.

For YFT, the tool reports fragment, drawable, LOD, geometry, triangle, bone-pose, and physics-child summaries. For YTD, it exports individual textures as DDS inspection files and records dimensions, pixel formats, mip levels, and hashes in JSON.

## Boundaries

This is a parser and inspection adapter, not a PS4 converter. It does not write YFT files or produce PS4-ready resources. YTD DDS extraction is not a platform conversion. A resource that parses successfully is not thereby proven compatible with a PS4 title ID or game build. The app must keep deployment disabled until a verified target writer and on-console tests exist.

Optional real-file integration checks can be run without committing mod assets:

```bash
GTAV_AUTOPORT_YFT=/path/to/glendale.yft GTAV_AUTOPORT_YTD=/path/to/glendale.ytd cargo test
```

The crate's format implementations are ported from CodeWalker and expose parsers for both YFT fragments and YTD dictionaries. The dependency is pinned by Cargo's lockfile when the first build is performed; no upstream source or binary is copied into this repository.
