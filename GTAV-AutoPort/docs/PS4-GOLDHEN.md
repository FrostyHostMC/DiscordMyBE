# PS4 / GoldHEN compatibility

The target is PS4 Story Mode. Every deployment must be matched to the user's exact GTA V title ID, region, installed update/build, and GoldHEN configuration.

GoldHEN plugins are native PS4-side modules. Windows PC `.asi` and `.dll` plugins are not interchangeable with PS4 `.prx` plugins. File redirection may be useful for resource replacements, but GTA V paths and compatibility must be verified on the target build.

## Current first target profile

The user has specified **CUSA00411 · GTA V 1.73 · PS4 Story Mode** as the first test target. This is recorded as a user-confirmed target label, not an independently verified compatibility result. The region/build mapping, exact executable/build fingerprint, resource formats, and GoldHEN redirection paths still require confirmation against the console and trusted retail files. Do not infer PS4 compatibility from the title ID or version label alone.

## Target profile required before deployment
- GTA V title ID (never assume a sample CUSA identifier is correct).
- Installed game update/build and region.
- GoldHEN version and enabled features.
- Resource deployment method and destination paths.

## Deployment safety
- Back up original game files and console data.
- Prefer reversible redirection where supported.
- Include a manifest and complete rollback instructions.
- Never deploy an unvalidated review bundle.
- Do not redistribute third-party PRX files or game assets without permission.

Reference: https://github.com/GoldHEN/GoldHEN_Plugins_Repository
