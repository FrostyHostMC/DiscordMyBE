# PS4 / GoldHEN compatibility

The Project V workspace targets GTA V Story Mode on PlayStation 4. Regional title IDs are explicit and must never be guessed from a version label.

## Supported target profiles

| Region | Title ID | Target update |
|---|---|---|
| US | CUSA00419 | 1.57 |
| EU | CUSA00411 | 1.57 |

The workspace selects a profile from the title ID read from local PS4 package metadata. If the title ID is unknown, no profile is selected. If update metadata is absent, the title ID match is provisional; it is not reported as a confirmed update match. If the update version differs, the profile is rejected.

The desktop application cannot inspect the live PS4 process or independently read the installed title ID. Package-header/PARAM.SFO inspection is local evidence only and does not prove that the package is installed or that the running executable matches it.

## Runtime and resource compatibility

GoldHEN plugins are native PS4-side modules. Windows PC `.asi` and `.dll` plugins are not interchangeable with PS4 `.prx` plugins. File redirection may be useful for resource replacements, but GTA V paths and compatibility must be verified on the exact target build.

Both regions can share resource-loader logic, but executable fingerprints, hook signatures, and addresses must be independently verified for each regional executable. A match on one region is not evidence for the other. Unknown builds must leave unsafe hooks disabled.

## Required evidence before deployment

- Installed title ID and update confirmed directly on the console.
- GoldHEN version and plugin-loading behavior confirmed on-console.
- Exact-build PS4 YFT/YTD reference resources inspected.
- Target-specific resource writers implemented and round-trip tested.
- Exact replacement paths and rollback procedure tested.
- Story Mode acceptance test completed for each supported region.

## Deployment safety

- Back up original game files and console data.
- Prefer reversible redirection where supported.
- Include a manifest and complete rollback instructions.
- Never deploy an unvalidated review bundle.
- Do not redistribute third-party PRX files or game assets without permission.
- GTA Online is out of scope.

Reference: https://github.com/GoldHEN/GoldHEN_Plugins_Repository
