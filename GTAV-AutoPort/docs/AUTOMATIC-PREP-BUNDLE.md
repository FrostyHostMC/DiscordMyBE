# Automatic preparation bundle

AutoPort can build one local ZIP hand-off bundle after a PC mod is imported. The bundle preserves every source file under `source-original/`, places successful RageKit rewrites of YFT/YDR/YDD/YTD under `pc-legacy-candidates/`, and includes raw file payloads from archives that pass the built-in PC RPF7 OPEN validator under `rpf-extracted/`. Each extracted path is reconstructed from the validated directory tree, and extracted bytes are copied without conversion. Raw extraction is bounded to 5,000 files and 512 MiB of total expanded payload by default; if an archive exceeds either limit, its validated inventory remains in the manifest and extraction is skipped. Unsupported/encrypted/Orbis RPF variants remain preserved as originals and receive an explicit inspection error in the manifest. Extracted files are also passed through the normal signature/extension classifier and bounded text dependency scanner, so references between metadata files inside a supported archive can be resolved in the dependency report. Eligible extracted resources can enter the same registered conversion-adapter pipeline as standalone uploads, while the original RPF remains unchanged. The ZIP also includes a machine-readable manifest, a short human-readable guide, and the automatic inspection reports already produced during intake.

A candidate is included only when RageKit conversion succeeds and its own output round-trip succeeds. Failed conversions remain visible in the manifest and the untouched original remains preserved. RPF extraction does not rewrite the archive or decode inner resource formats. Extracted files are separately classified and dependency-scanned; only registered conversion adapters can produce candidate outputs.

## Important compatibility boundary

The RageKit writer produces GTA V PC Legacy-format candidates. This is not a PS4 resource encoder. The bundle explicitly reports zero PS4-ready files and `installable: false` until a real CUSA00419 / GTA V 1.73 adapter and exact-build tests exist. It does not convert Windows ASI/DLL plugins into Orbis PRX binaries.

## Workflow

1. Import ZIP/OIV/7z or an extracted mod folder.
2. AutoPort performs its existing inventory, classification, metadata, native inspection and RPF inspection.
3. Choose **Build automatic prep bundle** once.
4. AutoPort inspects supported PC RPF7 OPEN archives and extracts their raw entries while preserving the archive originals; unsupported Orbis/encrypted variants are reported without guessing.
5. AutoPort converts every eligible YFT/YDR/YDD/YTD resource sequentially, retaining failures and originals.
6. Download one ZIP containing all results and the conversion manifest.

All processing remains local through the AutoPort helper. Per-resource conversion still obeys the native engine's configured size and runtime limits.
