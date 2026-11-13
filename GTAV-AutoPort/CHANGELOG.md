# Changelog

All notable GTAV AutoPort changes are recorded here. New development updates must also refresh the project README with a short latest-update summary and link to this changelog.

## Unreleased — ZIP intake and metadata analysis
- Added local ZIP archive intake with CRC verification, file inventory, case-insensitive duplicate detection, path traversal/absolute path rejection, symlink rejection, and entry/expanded-size limits.
- Added browser-side inspection of vehicle and handling metadata.
- Added model/texture dependency checks and RSC7 signature reporting.
- Added downloadable SHA-256 conversion manifest.
- Updated the dashboard with an operational import and analysis flow.
- Kept PS4 deployment locked: PC YFT/YTD assets are not converted by this update.
