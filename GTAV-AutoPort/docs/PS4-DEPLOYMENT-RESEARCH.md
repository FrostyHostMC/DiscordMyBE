# PS4 deployment research: GoldHEN AFR overlay

## What the upstream documentation establishes

The GoldHEN Plugins Repository documents an Application File Redirector (AFR) plugin named `afr.prx`. Its README says it redirects game file calls to `/data/`, and gives this mapping example:

- Game path: `/app0/hello_afr.txt`
- Redirected file: `/data/GoldHEN/AFR/CUSA00001/hello_afr.txt`

The same repository documents per-title plugin activation in `/data/GoldHEN/plugins.ini` and recommends title-specific sections. Its quick-start section says GoldHEN 2.3 or newer is needed for the plugin loader.

Upstream reference: https://github.com/GoldHEN/GoldHEN_Plugins_Repository

## AutoPort implementation

- `src/core/afr.js` generates a mergeable `plugins.ini` snippet for the configured CUSA title ID.
- The overlay planner accepts only explicit `/app0/...` mappings supplied by a future mapping/review step. It never guesses a PS4 path from a PC mod's folder name.
- The generated staging path follows the documented AFR layout: `/data/GoldHEN/AFR/<TITLE_ID>/<app0-relative-path>`.
- Path traversal, encoded separators, Windows paths, duplicate destinations and invalid title IDs are rejected.
- The planner always returns `deploymentAllowed: false` until exact target compatibility is established. It does not install AFR, change `plugins.ini`, connect to the console or copy files.

## Additional GTA V archive-layout evidence

The community project [AICyberGuardian/GoldSantos](https://github.com/AICyberGuardian/GoldSantos) documents an AFR workflow for GTA V CUSA00411 version 1.56. Its AFR notes say GTA V requests an archive container such as `/app0/update/update.rpf`, and that custom handling/visual-setting files are staged inside a rebuilt `update.rpf` under the AFR title-ID folder. Its staging script and deploy script are useful architecture references, but they are community documentation for version 1.56—not proof for the user's version 1.57.

This changes the mapping rule: redirecting an individual loose file may do nothing if the game only opens its containing RPF. AutoPort must identify the actual file-open path used by the exact game build and may need to rebuild and redirect the whole archive container rather than map an internal RPF member as a loose file.

## What remains unverified

The public AFR README does not establish that a particular GTA V CUSA00419 or CUSA00411 update 1.57 file is requested through the expected `/app0` path, that the AFR plugin build works with the user's exact PS4 firmware/GoldHEN combination, or that a PC RPF/resource can simply be redirected and loaded by the PS4 game.

Therefore AFR is a promising deployment mechanism for a later validated overlay, not a universal mod loader and not proof of compatibility. The v1.56 community workflow is a research reference only and must not be copied as a confirmed v1.57 install recipe. The next work is to verify real CUSA00419 1.57 file paths and resource requirements using user-owned reference files, then build a staged overlay and validate it on the exact console/game build.

## Safety policy

- Story Mode only; no GTA Online deployment.
- Never overwrite the installed game package or update files directly.
- Keep the original game files and saves untouched.
- Generate a reversible, file-by-file overlay with hashes and a manifest.
- Do not enable a plugin or deploy files until the user explicitly approves a reviewed manifest.

## Plugin-first deployment: EBOOT is not a prerequisite

A decrypted or rebuilt EBOOT.BIN is **not a general installation prerequisite** for GoldHEN plugin/overlay mods. GoldHEN's official plugin repository documents loading PRX plugins before game boot, with per-title entries in `/data/GoldHEN/plugins.ini`; the documented plugin directory is `/data/GoldHEN/plugins/`. It also documents AFR (`afr.prx`) as a separate file-redirection plugin using `/data/GoldHEN/AFR/<TITLE_ID>/` overlays.

A real GTA V example is the public Lotus GoldHEN SPRX port. Its README instructs users to place an SPRX in the GoldHEN plugins directory and add a per-title entry to `plugins.ini`. However, that release specifically calls out GTA V updates 1.27 and 1.48 and uses CUSA00419 but only documents older updates 1.27 and 1.48; it is proof of the plugin-based method, **not** proof that its binary or hooks work on CUSA00419 update 1.57.

References:
- GoldHEN plugin loading and AFR: https://github.com/GoldHEN/GoldHEN_Plugins_Repository
- GTA V Lotus SPRX installation example: https://github.com/illusionyy/PS4-GTAV-Lotus-SPRX-Release

### AutoPort output policy

AutoPort must select the least invasive valid deployment mechanism per mod:
1. **AFR overlay only** when the mod consists of replacement files and the exact GTA V 1.57 game-open path/container has been verified.
2. **GoldHEN PRX/SPRX + config** when runtime behavior needs a native PS4 plugin and a plugin build is verified for the exact title/update/GoldHEN environment.
3. **Combined plugin + overlay** when both a runtime hook and replacement assets are required.
4. **Rebuilt game package/EBOOT workflow** only when a specific mod or patch demonstrably requires executable changes. This is an advanced, separate path—not the default.

JSON, XML, INI and other configuration files are not automatically executable or meaningful on PS4. AutoPort must identify which plugin or game subsystem consumes each config, validate its schema/version, and package it at the exact expected location. A `.sprx` extension alone also does not establish compatibility: the binary must target the PS4 Orbis ABI and the correct GTA V build/hooks.

The user's decrypted EBOOT may still be useful as an optional research artifact for build identification, reverse engineering, or validating a version-specific hook. It is not required merely to stage a known-good GoldHEN plugin or AFR overlay. AutoPort must not block plugin/overlay work while waiting for it.
