# PS4 conversion backend research

## Existing open-source reference implementation

Research identified `RaringM/ps5-gtav-menu` as a substantive PS4/PS5 custom-content pipeline, not just a plugin loader. Its documented PS4 target is **GTA V Legacy CUSA00411 version 01.57**, with custom packs marked experimental. The repository includes PC-to-PS4 resource conversion tools for vehicles, peds, drawables, maps, collision and PS4 texture dictionaries, plus a runtime custom-pack format and validator.

Upstream references:
- Repository: https://github.com/RaringM/ps5-gtav-menu
- Pack author guide: https://github.com/RaringM/ps5-gtav-menu/blob/main/docs/pack-author-guide.md
- Pack reference: https://github.com/RaringM/ps5-gtav-menu/blob/main/docs/pack-reference.md
- PS4 texture writer: https://github.com/RaringM/ps5-gtav-menu/blob/main/tools/gtavmenu_tools/ps4_texture_writer.py
- PC vehicle converter: https://github.com/RaringM/ps5-gtav-menu/blob/main/tools/convert_pc_vehicle.py
- PC ped converter: https://github.com/RaringM/ps5-gtav-menu/blob/main/tools/convert_pc_ped.py

## Regional target boundary

AutoPort's requested targets are **CUSA00419 (US)** and **CUSA00411 (EU)**, both GTA V **1.57**. The upstream backend's published build pins and native runtime evidence are specifically for **CUSA00411 01.57**. That is relevant EU evidence, but it is not proof for US CUSA00419. Do not reuse the EU executable fingerprint, offsets, hooks, plugin binary or resource templates for the US executable.

The converters rely on templates extracted from a matching game build. An EU CUSA00411 template cache is not evidence for US CUSA00419, even when both are labeled 1.57. Keep separate target fingerprints, template inventories, validation records and compatibility statuses.

## AutoPort integration policy

1. Treat this project as a candidate conversion backend and study/reuse its format algorithms under its license and third-party notices.
2. Keep PC intake, diagnostics, dependency graphs and conversion logs in AutoPort.
3. Add a backend adapter only after its target profile, required Python dependencies, source formats, generated pack schema and error/refusal behavior are pinned and tested.
4. Do not label any output PS4-ready merely because the EU CUSA00411 1.57 backend can create it.
5. Require independent US CUSA00419 1.57 executable/resource evidence before enabling the US target.
6. Keep unknown title IDs and update versions fail-closed; never substitute one region's profile for another.

## What this means for the first playable test

- The upstream project is evidence that PC-to-PS4 asset conversion is technically achievable for a pinned PS4 build, including texture, vehicle and ped workflows.
- It is a promising EU CUSA00411 1.57 backend reference, not a verified ready-to-install package for both requested regions.
- AutoPort must report the EU backend candidate separately from the US target and keep compatibility unverified until exact regional evidence is checked.

## Current AutoPort status

The exact regional profiles are maintained in `src/core/target.js`. The user's requested title IDs and version are configuration targets, not proof that the console's executable has been independently fingerprinted. `verifiedAgainstConsole` remains false and resource compatibility remains unverified for both regions.
