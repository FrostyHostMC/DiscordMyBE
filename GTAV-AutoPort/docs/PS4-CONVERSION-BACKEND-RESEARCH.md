# PS4 conversion backend research

## Candidate repository reviewed

Repository: https://github.com/RaringM/ps5-gtav-menu
License: repository LICENSE declares MIT; THIRD_PARTY_NOTICES documents additional provenance and licensing constraints.

This is a substantial GTA V Story Mode menu/runtime project with an experimental PS4 Legacy plugin profile for **CUSA00411 / 01.57**. Its README explicitly lists PS4 custom packs as experimental. It is not a ready-made AutoPort backend for the user's **CUSA00419 / 1.57** installation.

### What is genuinely PS4-specific

- data/targets/ps4/cusa00411-01.57.json pins a different title ID, executable hashes, loader addresses, native addresses and feature profile.
- tools/gtavmenu_tools/ps4_texture_reader.py and ps4_texture_writer.py implement/read PS4 Legacy texture dictionary structures and BC1/BC3/BC5 Thin1DThin storage.
- tools/gtavmenu_tools/ps4_resource_checks.py checks PS4 fragment vertex declarations and texture storage invariants.
- tools/ps4_fragment_convert.ps1 makes a narrow Legacy fragment declaration change (PC BlendIndices Colour type to PS4 UByte4) using a separately supplied CodeWalker.Core.dll and verifies serialized geometry fingerprints.
- tools/gtavmenu_tools/ps4_build.py configures the PS4 plugin build from the pinned target manifest.

### What must not be misrepresented

The upstream pack reference primarily documents PS5 RSC7 assets and PS5 target packs. The prominent PC vehicle and ped converters import PS5 texture writers/readers and depend on PS5 retail templates. They are not generic CUSA00419 PS4 vehicle/ped converters. The existence of a PS4 texture writer or one fragment fix-up does not make the full PS5 content pipeline PS4-compatible.

The PS4 plugin manifest is CUSA00411 / 01.57, not CUSA00419 / 1.57. Although the reported update number matches, the title ID, executable hash, native offsets, loader hooks and resource template provenance differ. AutoPort must not copy its plugin, offsets, target manifest or resource templates into the user's CUSA00419 profile.

## AutoPort work derived from the research

AutoPort has independently implemented an experimental DDS BC1/BC3/BC5 to PS4 Thin1DThin storage-layout stage. It verifies the output by un-tiling and comparing every compressed block byte. This stage is intentionally limited to raw texture storage payloads; it does not create a complete RSC7/YTD dictionary and does not mark output installable.

See [PS4 texture storage adapter](PS4-TEXTURE-STORAGE-ADAPTER.md).

## Integration policy

1. Keep the upstream repository as a research/reference source, not a binary dependency.
2. Reimplement only clearly understood, licensed algorithms behind AutoPort's own adapter contract.
3. Preserve attribution and all applicable third-party notices. Do not redistribute CodeWalker-derived source/data or its DLL without resolving the upstream licensing constraints.
4. Require CUSA00419 / 1.57 retail reference resources and hashes before target-specific serialization.
5. Require independent readers and real target tests before enabling a writer.
6. Keep plugin/runtime offsets, custom-pack loader behavior and executable identity isolated by exact title ID and build fingerprint.

## Current conclusion

The upstream project confirms that a PS4-specific texture storage and runtime-pack path exists for a different US/region title profile, but its custom packs are experimental and its core model/ped converters are not a drop-in PS4 backend. AutoPort's next concrete step is to complete a full PS4 texture dictionary writer around its own tested storage-layout primitive, using lawful CUSA00419 / 1.57 reference data. Until then, the PS4 texture output is a partial conversion candidate only.
