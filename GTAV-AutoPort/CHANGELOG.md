# Changelog

All notable GTAV AutoPort changes are recorded here. Every development update must also refresh the latest-update summary in README.md.

## 2026-11-13 — Native inspector dashboard integration
- Added `START-AUTOPORT.bat` for local workbench startup and first-run dependency installation.
- Added `RUN-NATIVE-INSPECTOR.bat` plus a PowerShell file-picker workflow to inspect multiple YFT LOD files and the matching YTD into one output folder.
- Added support for multiple named YFT reports and dashboard metric cards for each selected model.
- Added a manual GitHub Actions workflow trigger for maintainers.
- Hardened report loading with required YFT fragment/YTD texture structures, relative-only PNG preview paths, and PNG signature validation.
- Added a separate native output folder import control.
- Added versioned JSON report validation and safe preview-file matching.
- Connected YFT structural report metrics to the dashboard.
- Connected YTD texture metadata and PNG previews to a responsive texture gallery.
- Added native report parser tests for successful reports, missing reports, invalid schema, duplicate reports, and preview linking.
- Kept all PS4 conversion and deployment gates closed.

## 2026-11-13 — Native YFT/YTD inspection foundation
- Added a Rust native inspector using the Unlicense-licensed `VIRUXE/rage-formats` crate.
- Added read-only YFT fragment parsing with drawable LOD, model, geometry, triangle, bone-transform, and physics-child summaries.
- Added YTD texture dictionary parsing, per-texture DDS extraction, PNG previews where decoding succeeds, and metadata reports.
- Added extracted-folder intake alongside ZIP import in the browser workbench.
- Added duplicate-basename rejection and ambiguous vehicle asset reporting.
- Added RSC7 header inspection for magic, version, system flags, graphics flags, and payload size. Version comparison is explicitly limited to values observed in the supplied Glendale fixture; it is not a platform detector.
- Added tests for folder/ZIP intake and RSC7 header handling.
- Added GitHub Actions workflow at the repository root to run JavaScript tests/build and Rust tests/build for AutoPort changes.
- Added opt-in integration tests for local real YFT/YTD files, keeping mod binaries out of GitHub.
- No PS4 conversion, YFT writing, console deployment, or installable package is claimed.

## 2026-11-13 — ZIP intake and metadata analysis
- Added local ZIP archive intake with CRC verification and a visible file inventory.
- Added checks for absolute/traversal paths, duplicate case-insensitive paths, symbolic links, entry count, and total uncompressed size.
- Added vehicle and handling metadata matching by model name and handling ID.
- Added expected YFT/YTD dependency checks and basic RSC7 signature identification.
- Added downloadable SHA-256 conversion manifest.
- Replaced the placeholder import button with a working browser-side ZIP import and analysis flow.
- Kept PS4 deployment locked because no tested PC-to-PS4 YFT/YTD converter exists yet.

## Initial project setup
- Created isolated AutoPort workspace under GTAV-AutoPort/ on branch project/gtav-autoport.
- Added architecture, GoldHEN notes, Crown Victoria fixture notes, roadmap, React/Vite UI shell, and metadata inspection tests.
