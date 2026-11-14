# Changelog

## 2026-11-14 — Upstream engine integration audit and intake regression fix
- Fixed a malformed newline escape in the browser-side RageKit candidate module that caused the latest JavaScript test run to fail before Vite could build.
- Confirmed the pinned RageKit v0.3.1 dependency configures and builds successfully in CI; it remains the primary native parser/writer for its documented GTA V Legacy/Enhanced formats.
- Added an upstream integration register distinguishing dependencies that are actually wired into AutoPort from reference-only PS4 projects and optional supplemental tooling.
- Recorded GoldSantos and InsulinGTAV as PS4 research references only: their documented game targets are 1.56 and 1.57 respectively, not the user's 1.73 target.
- Kept PS4 resource conversion, runtime compatibility, and deployment blocked until exact-build reference assets and console validation exist.

## 2026-11-13 — RPF archive validation added
- Added `.rpf` to the native RAGE engine validation intake so archives are parsed and round-tripped in temporary local storage when the backend is configured.
- Updated automatic workbench selection to include RPF archives instead of skipping them.
- Kept encryption-key requirements, PS4 resource compatibility, and deployment as explicit unresolved gates; archive round-trip is not a PS4 conversion.


## 2026-11-13 — GoldHEN target recorded
- Recorded the user-confirmed GoldHEN version `2.4b18.13` and PS4 firmware `14.00` separately from GTA V update `1.73`.
- Kept the supplied `.13` suffix as user-confirmed; official release metadata found for this check confirms the `2.4b18` release family.
- Added target-profile regression coverage; no compatibility or installability is inferred.


## 2026-11-13 — PS4 firmware target recorded
- Added user-confirmed PS4 system firmware 14.00 as a separate target field; kept GTA V title update 1.73 distinct.
- Added regression coverage and left GoldHEN version unset until the user confirms the installed release.
- No PS4 resource compatibility or installability is inferred from firmware identification.


## 2026-11-13 — AutoPort JSX build repair
- Corrected malformed JSX expression delimiters around the busy and idle native-inspection status messages, resolving the Vite transform error.
- Fixed an extra closing JSX brace in the native-inspection status area that prevented the Vite production build from compiling.
- Kept the native-engine and PS4 compatibility gates unchanged.


## 2026-11-13 — Native backend CI coverage
- Added a dedicated CI job to configure and compile the pinned ragekit CLI backend, so native integration build failures are caught rather than assumed away.


## 2026-11-13 — Dependency graph regression alignment
- Corrected a stale dependency-graph test expectation to include the explicit handling.meta edge and resolved count.


## 2026-11-13 — Native ragekit resource-engine integration
- Pinned MIT-licensed ragekit v0.3.1 as a native CMake dependency and added a Windows build helper.
- Added a local-only Vite middleware endpoint that invokes the real rk info parser and rk roundtrip writer for supported RAGE resources.
- Added SHA-256 source/output comparison and per-file reports for parsed state, byte-exact round-trip state, non-identical rewrites, failures and parser details.
- Added automatic workbench invocation and downloadable native validation reports; unconfigured engine state is surfaced without claiming conversion.
- Explicitly retained PS4 writer, CUSA00411/1.73 compatibility and deployment gates as blocked.


## 2026-11-13 — Universal resource-family port planning
- Added `buildUniversalPortPlan()` to route 30+ common GTA V resource/source extensions into family-specific work stages with explicit source capability, target gap, status and blocker fields.
- Added cautious filename-co-location candidates for related model/texture/collision files; all such relationships are marked unverified rather than asserted as dependencies.
- Added workbench integration so every import produces a visible per-family port worklist and downloadable JSON plan.
- Added regression tests for mixed-family plans, uncertain relationships, target identity, empty input and non-installable status.
- Documented the next native adapter and PS4 writer validation sequence.


## 2026-11-13 — Format-engine research and universal automatic mod audit
- Researched ragekit, FiveFury, rage-formats, RPF archive tooling, Sollumz, OpenIV PS4 support history and GoldHEN's native PRX SDK.
- Added backend research and selected ragekit as the first broad native-engine evaluation candidate, with FiveFury as supplemental coverage; neither is treated as PS4-compatible without exact-build proof.
- Added automatic mod-family classification, conservative file-signature detection, unknown-file preservation and explicit PC-native plugin/script warnings.
- Reframed the workspace UI around universal mod intake rather than vehicle-only conversion.


## 2026-11-13 — Product scope expanded to universal GTA V mod porting
- Reframed AutoPort from a vehicle-only converter to a general PC-to-PS4 Story Mode mod-porting platform.
- Defined coverage for vehicles, peds/player models, weapons, props, maps/world assets, textures, audio, animations, UI/HUD, scripts, plugins and unknown resources.
- Added compatibility classes for directly portable, convertible, adaptation-required, runtime-dependent and unsupported content.
- Specified a typed resource-graph IR, family-specific adapters, dependency resolution, independent validation and reversible packaging.
- Documented that PC native plugins and Windows runtime-dependent mods cannot be copied to PS4 as-is.


## 2026-11-13 — Generic model discovery and dependency inventory
- Removed the Glendale model-name default; model choices are discovered from each imported `vehicles.meta` file.
- Added a generic inventory classifier and explicit dependency graph for model resources, texture dictionaries and handling metadata.
- Missing and ambiguous dependencies are reported rather than guessed; graph scope explicitly states that full DLC/archive resolution is not yet implemented.
- Added model discovery and generic dependency graph regression tests.


## 2026-11-13 — Universal vehicle-port architecture defined
- Added a vehicle-agnostic architecture covering source intake, dependency graph, platform-neutral vehicle IR, target-specific resource adapters, round-trip validation, package/rollback and replacement versus add-on separation.
- Prohibited Glendale/model-name/handling-ID-specific conversion assumptions.
- Recorded that the current rage-formats YFT/YTD path is read-only and cannot be treated as a target writer.
- Documented exact-build PS4 reference-resource evidence required before a PS4 encoder can be implemented and validated.


## 2026-11-13 — Automatic native inspection on import
- Added a local Vite middleware endpoint that runs the Rust read-only inspector for imported YFT/YTD files.
- ZIP and folder imports now automatically populate native YFT summaries and YTD texture previews without a separate report-folder import.
- Temporary source and output files are cleaned up after inspection; Rust/Cargo is required locally.
- Documented that a packaged desktop runtime remains future work.

## 2026-11-13 — Evidence-based PS4 compatibility gates
- Added a compatibility assessment model for exact console confirmation, GoldHEN version, PS4 YFT/YTD reference resources, format adapters, and deployment/rollback validation.
- Added a dashboard checklist that explains why conversion remains blocked and what evidence is needed next.
- Added regression tests proving that PC-side inspection and a completed checklist cannot silently enable conversion or deployment.


## 2026-11-13 — Native report test assertion aligned
- Corrected the duplicate-report test expectation to match the loader's explicit duplicate generic report error message. No runtime behavior changed.

All notable GTAV AutoPort changes are recorded here. Every development update must also refresh the latest-update summary in README.md.

## 2026-11-13 — First PS4 target profile recorded
- Added a dedicated profile for the user-specified CUSA00411 / GTA V 1.73 / PS4 Story Mode target.
- Included the target profile in exported analysis manifests and displayed it in the workbench.
- Added target profile regression tests and explicit unverified-compatibility flags.
- Updated GoldHEN deployment notes and roadmap; exact console build and resource compatibility remain to be verified.

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
