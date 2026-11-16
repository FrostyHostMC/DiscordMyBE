# Native PS4 mod library and GoldHEN configuration

## Current implementation milestone

The PS4 companion app now compiles two reusable native modules:

- `platform/library.cpp`: bounded, read-only inventory of staged files and directories. It ignores hidden entries and symlinks, rejects an invalid library root, limits recursion depth and item count, records file sizes/extensions, and calculates a 64-bit FNV-1a inventory fingerprint.
- `platform/goldhen_config.cpp`: title-ID and plugin-path validation, config preview, first-backup creation, explicit plugin-entry addition, and backup restore. Writes use a temporary file, flush/fsync, and atomic rename. The module refuses traversal, non-plugin extensions, ambiguous pre-existing title sections, missing plugin binaries, and overwriting an existing backup.

The FNV-1a value is only a quick inventory fingerprint. It is **not SHA-256**, must not be used as a security or compatibility proof, and will be replaced or supplemented by a cryptographic digest before signed manifests or integrity decisions are introduced.

## Important current limits

These modules are compiled into the app but are not yet connected to the controller UI. The existing screen remains the USB/import browser until the Library and GoldHEN screens are integrated.

The GoldHEN module does not install PRX files, edit a live config automatically, enable a plugin at startup, or deploy AFR overlays. A caller must explicitly request an operation. It expects the selected plugin binary to already exist under `/data/GoldHEN/plugins/`. Existing title sections with entries are deliberately rejected rather than rewritten because GoldHEN INI variants and ordering need fixture coverage first.

## Archive extraction work still required

The PS4 app does not yet extract ZIP, 7z, or OIV packages. Desktop-side ZIP/7z/OIV intake is a separate workbench capability and must not be mistaken for native PS4 extraction.

Before enabling extraction on PS4, AutoPort needs a pinned, license-reviewed archive backend that is built for the OpenOrbis target and covered by CI. The backend must expose a streaming interface so the app can enforce limits while bytes are being written, not only after extraction. Required controls:

- accept only relative normalized paths beneath a newly-created destination directory;
- reject absolute paths, drive prefixes, backslashes, `..`, empty path components, symlinks, hardlinks, and special files;
- reject duplicate normalized output paths and case-fold collisions;
- reject encrypted archives until an explicit, secure password flow exists;
- enforce compressed input, expanded byte, per-file byte, file-count, path-length, and nesting-depth limits;
- stream to a temporary file, verify declared and actual byte counts, flush/fsync, then atomically rename;
- keep extraction separate from installation and never write into the game package;
- preserve an extraction report and source archive fingerprint.

ZIP/OIV should be the first native target because OIV is ZIP-based. 7z support should follow only after a PS4-compatible backend is pinned and built. Unsupported compression methods must fail closed with a clear report.

## GoldHEN and deployment boundary

The manager targets the documented `/data/GoldHEN/plugins.ini` location and title-specific CUSA sections. It is a configuration editor, not a compatibility oracle. A valid-looking PRX path does not prove that the plugin is built for the Orbis ABI or supports the selected GTA V executable.

AFR remains a separate overlay workflow. AutoPort must keep US CUSA00419 and EU CUSA00411 evidence independent, require explicit reviewed mappings, and leave deployment disabled until the exact GTA V 1.57 paths and plugin compatibility are verified. Story Mode only; no GTA Online deployment.

## Next integration steps

1. Add Library and GoldHEN pages to the controller UI with confirmation prompts and readable error states.
2. Add native ZIP/OIV extraction behind the reviewed streaming archive adapter and host-side adversarial fixtures.
3. Add SHA-256 manifests, mod grouping, tags, and explicit remove/restore actions.
4. Add config diff/preview and a restore workflow to the UI.
5. Keep all deployment actions gated by exact-target evidence and explicit user approval.
