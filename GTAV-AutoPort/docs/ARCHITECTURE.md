# Architecture

## Isolation
All AutoPort work lives under `GTAV-AutoPort/` and on branch `project/gtav-autoport`. Do not edit files outside this directory for AutoPort tasks. No AutoBE code, build scripts, dependencies, or runtime behavior should be changed.

## Planned stack
- Tauri 2 desktop shell with React UI.
- Rust core for safe filesystem operations and conversion orchestration.
- Local project workspace; no cloud file storage.
- Format adapters with explicit input/output platform declarations.

## Pipeline
1. Import ZIP or folder; validate paths, sizes, and archive entries.
2. Inventory files, compute hashes, detect signatures and classify platform-specific content.
3. Determine vehicle replacement vs add-on.
4. Parse `vehicles.meta` and `handling.meta`; select only matching entries.
5. Resolve model, texture, handling, and DLC dependencies.
6. Inspect YFT/YTD containers read-only.
7. Convert using a tested PS4-compatible adapter for the detected game build.
8. Validate references, paths, and target compatibility.
9. Produce loose files and deployment package with manifest and rollback instructions.

## Hard rules
- Never execute imported scripts or binaries.
- Never replace an entire metadata file when a single entry is intended.
- Preserve source files and unrelated metadata entries.
- Do not treat PC `.asi`/`.dll` files as PS4 `.prx` plugins.
- Review bundles are not installable packages.
