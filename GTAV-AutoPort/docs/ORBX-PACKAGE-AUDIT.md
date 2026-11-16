# ORBX Engine package audit

## What the public vendor listing says

The public ORBX Engine v1.4 listing advertises support for these GTA V PS4 versions:

- 1.00
- 1.32
- 1.38
- 1.46
- 1.47
- 1.48
- 1.49
- 1.50
- 1.51
- 1.52
- 1.53
- 1.55
- 1.56

It advertises loading main-game RPFs, DLC RPFs, XML, OMT, META, DAT, GXT2 and GFX files, plus a `dlclist.xml` loader. The v1.3.4 description says file types can be selected in `orbx.ini` and names an `AvoidCrcCheckedFiles` option.

Source: https://ko-fi.com/s/8b1c775f83

This is the vendor's published claim, not an independent test matrix. The listing does not publish the complete INI schema, a source release for `orbx.prx`, a compatibility statement for every title ID, or a 1.57 test. A version not named in the listing is **unlisted**, not proof that it is technically impossible to use.

## User-supplied archive

The user supplied `Orbx Engine v1.4.7z` and the archive password in chat. The archive is a 7-Zip container with encrypted content. The current inspection runtime has no 7-Zip executable or Python 7z library, and network access is unavailable to install one. A previous extraction attempt left a zero-byte `orbx.ini` placeholder; that zero-byte file is not the vendor's configuration and must not be used.

Do not claim to have read the INI or PRX until extraction succeeds. The package inventory previously surfaced the expected names `orbx.prx`, `orbx/orbx.ini`, `orbx/rpf_log.txt` and RPF assets, but their contents and hashes still need direct extraction and verification.

## Installation paths to audit

The runtime error reported by the user names:

```text
/data/orbx/orbx.ini
```

The expected GoldHEN plugin directory is commonly:

```text
/data/GoldHEN/plugins/
```

The GoldHEN plugin repository documents per-title plugin configuration in `plugins.ini` and plugin files in the GoldHEN plugins directory:

https://github.com/GoldHEN/GoldHEN_Plugins_Repository

The package's nested vendor folder layout must be flattened carefully during installation. Do not copy an extra enclosing `Orbx Engine v1.4/Orbx Engine v1.4/` directory into a runtime location. Keep the plugin binary, INI and resource tree at the paths expected by the loader. The precise destination for each RPF must be confirmed from the extracted INI/instructions/log, not inferred from its filename.

## Compatibility interpretation

- A PRX extension is not proof that a binary is an Orbis PRX or that its hooks match the running game.
- The vendor's published version list is useful evidence, but absence of 1.57 from that list is not itself a technical diagnosis.
- Do not patch a version string, bypass a version check, change executable offsets, or fabricate an INI schema without source/debug evidence.
- First distinguish a missing configuration path, malformed INI, plugin load failure, hook/build mismatch, and resource parsing failure using the actual error and `rpf_log.txt`.
- Keep the graphics archives separate from the loader binary. If the loader fails before reading assets, changing textures or repacking RPFs will not repair that initialization failure.

## AutoPort implementation

`src/core/orbxPackageInspector.js` adds a read-only package audit. It detects `orbx.prx`, `orbx.ini`, RPF archives and files under an `orbx/gta/` resource tree, reports duplicate or missing components, and suggests the runtime INI path from the observed error. It does not modify PRX binaries, invent INI values, execute package scripts, deploy files or claim compatibility.

The automatic preparation ZIP now includes `reports/orbx-package-audit.json` and embeds the audit in `autoport-manifest.json`. The report deliberately keeps `contentsInspected`, `runtimeCompatibilityVerified` and `deploymentAuthorized` false until actual evidence exists.

## Next evidence needed

1. Extract the archive on a machine with 7-Zip and provide the real `orbx.ini`, `rpf_log.txt` and `orbx.prx` (or a report containing their hashes and text).
2. Confirm the exact installed paths on the PS4 and the exact error text.
3. Compare the INI keys with the loader's observed file-open attempts/log output.
4. Only after the loader reaches resource loading should individual RPF and graphics resources be investigated.

## Second archive inventory pass (user-supplied encrypted 7z)

A second inventory pass used the archive password supplied by the user to read the 7z directory metadata. The available libarchive 3.7.4 build can enumerate the encrypted archive's directory and declared file sizes, but it reports that encrypted file content is unsupported. Therefore no file payload was decrypted or read in this pass.

Observed directory metadata:
- 3,677 entries total: 3,335 files and 342 directories.
- `orbx.prx`: 1,243,584 bytes.
- `orbx/orbx.ini`: 457 bytes.
- `orbx/rpf_log.txt`: 916,419 bytes.
- `Instructions.txt`: 357 bytes.
- `ps4a.rpf`: 51,662,848 bytes.
- Resource payload inventory includes 128 META, 72 XML, 19 OMT, 13 DAT and one BIK file.
- The inventory contains 3,097 zero-byte files ending in `.rpf.txt`; these are path-marker/text files, not RPF archives. AutoPort must not classify them as actual archive payloads.
- The package paths repeat the enclosing folder name: `Orbx Engine v1.4/Orbx Engine v1.4/` before the plugin/resource package root. Installation staging should flatten the outer archive wrapper rather than reproduce this duplicated nesting.

This inventory is directory metadata only. Declared sizes do not prove payload contents or successful extraction. In particular, `orbx.ini`, `rpf_log.txt`, `Instructions.txt`, `orbx.prx` and `ps4a.rpf` have not yet been read or hashed from their decrypted bytes.

## Inspector update

The ORBX audit now:
- Parses an uploaded plain-text INI (up to 64 KiB) without generating or modifying settings.
- Reports sections, key/value pairs, duplicate keys, malformed line numbers and whether `AvoidCrcCheckedFiles` appears.
- Distinguishes `.rpf.txt` path markers from real `.rpf` files.
- Counts resource file extensions and records marker samples.
- Detects repeated adjacent package folder names.
- Reports the presence and paths of `rpf_log.txt` and `Instructions.txt`.\n- Parses a supplied `rpf_log.txt` up to 1 MiB and extracts bounded error, compatibility, CRC and warning excerpts with line numbers; it never treats the excerpts as proof of a specific root cause.

A parsed INI is not considered valid for ORBX merely because it is syntactically parseable. `runtimeCompatibilityVerified` remains false.