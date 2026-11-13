# Changelog

All notable GTAV AutoPort changes are recorded here. Every development update must also refresh the latest-update summary in README.md.

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
