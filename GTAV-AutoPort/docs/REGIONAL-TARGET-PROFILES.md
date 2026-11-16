# Regional GTA V 1.57 target profiles

## Supported title-ID records

| Region | Title ID | Game update | Profile status |
|---|---|---:|---|
| US | CUSA00419 | 1.57 | User-recorded target |
| EU | CUSA00411 | 1.57 | Research/reference target |

The workspace resolves a supplied title ID to one of these records. Unknown title IDs return no profile; they must not silently fall back to the US default.

## What profile resolution means

A recognized title ID identifies which regional compatibility record should be considered. It does **not** prove that:
- the running EBOOT is the expected 1.57 executable;
- a hook signature or offset is valid;
- a resource file is compatible with that region;
- a PRX can safely load or patch the game;
- an AFR destination path is correct.

The desktop workspace currently defaults to the user-recorded US profile for legacy workflows. The EU record intentionally does not inherit the US publisher/content ID, firmware, or GoldHEN evidence.

## Required runtime behavior for a future GoldHEN plugin

The actual PS4 plugin must implement these steps independently of this desktop profile registry:

1. Read the running title ID.
2. Select the matching region profile; reject unknown IDs.
3. Fingerprint the loaded executable and verify the exact update build.
4. Validate each hook's masked signature and expected prologue before writing or detouring.
5. Install only hooks whose dependencies and validation checks pass.
6. Log title ID, detected build, hook status, and failure reasons.
7. Leave unsupported hooks disabled and keep the game running without unsafe patches.

US and EU executable signatures, offsets, and resource assumptions must be verified independently. Do not copy offsets from CUSA00411 into CUSA00419 or vice versa.

## Current implementation boundary

This change adds a region-aware profile registry and compatibility reporting to the **desktop workspace**. It does not modify the third-party Project V PRX, create a GoldHEN binary, discover a live PS4 process, or validate either region's executable hooks. The profile registry is a safe foundation, not a claim that the runtime plugin is complete.

## New-user guidance

- Select the profile that matches the title ID shown by the user's own game installation.
- If the title ID is not recognized, stop and request a profile review instead of guessing.
- Keep source inspection, PC-format round trips, PS4 resource conversion, and on-console validation as separate evidence stages.
- Never install PC ASI, DLL, EXE, ScriptHookV, or .NET payloads as PS4 plugins.
