# Automatic preparation bundle

AutoPort can build one local ZIP hand-off bundle after a PC mod is imported. The bundle preserves every source file under `source-original/`, places successful RageKit rewrites of YFT/YDR/YDD/YTD under `pc-legacy-candidates/`, and includes a machine-readable manifest, a short human-readable guide, and the automatic inspection reports already produced during intake (port plan, classification, native inspection, RageKit archive/resource results, script/plugin review, metadata and format-specific reports where available).

A candidate is included only when RageKit conversion succeeds and its own output round-trip succeeds. Failed conversions remain visible in the manifest and the untouched original remains preserved.

## Important compatibility boundary

The RageKit writer produces GTA V PC Legacy-format candidates. This is not a PS4 resource encoder. The bundle explicitly reports zero PS4-ready files and `installable: false` until a real CUSA00419 / GTA V 1.73 adapter and exact-build tests exist. It does not convert Windows ASI/DLL plugins into Orbis PRX binaries.

## Workflow

1. Import ZIP/OIV/7z or an extracted mod folder.
2. AutoPort performs its existing inventory, classification, metadata, native inspection and RPF inspection.
3. Choose **Build automatic prep bundle** once.
4. AutoPort converts every eligible YFT/YDR/YDD/YTD resource sequentially, retaining failures and originals.
5. Download one ZIP containing all results and the conversion manifest.

All processing remains local through the AutoPort helper. Per-resource conversion still obeys the native engine's configured size and runtime limits.
