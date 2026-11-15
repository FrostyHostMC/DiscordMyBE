# AutoPort native RAGE engine

This CMake project pins the MIT-licensed [RatPrez/ragekit](https://github.com/RatPrez/ragekit) release **v0.3.1** and builds its `rk` command-line engine. It does not copy game files or ship proprietary game data.

## Build (Windows)

Requirements: Git, CMake 3.20+, and a C++20 compiler (Visual Studio 2022 Build Tools or another supported MSVC toolchain).

From `GTAV-AutoPort`:

```powershell
cmake -S native-engine -B build/ragekit -DCMAKE_BUILD_TYPE=Release
cmake --build build/ragekit --config Release --target rk
```

The executable is normally `build/ragekit/_deps/ragekit-build/Release/rk.exe` with a Visual Studio multi-config generator, or the corresponding `.../rk.exe` path for a single-config generator. Set `GTAV_AUTOPORT_RK` to the exact executable path to enable automatic integration.

## What the integration does

For each supported RAGE resource imported into the local workbench, the native endpoint runs:
- `rk info -v <file>` to parse and describe the resource using ragekit.
- `rk roundtrip <file> <temporary-copy>` to exercise the library's reader and writer.
- SHA-256 comparison of source and rewritten bytes; the report records byte equality, sizes, parser output, and any error.

Temporary source/copy files are removed after the report is generated. The endpoint is local Vite middleware, not a public upload service. A round-trip pass proves only that this pinned backend can read and rewrite that particular source file under its current edition assumptions. It does **not** prove PS4 compatibility, in-game correctness, dependency completeness, or installability.

RPF files may require keys from the user's own game installation. PC Legacy/Enhanced resource support is not evidence of PS4 resource support. The target writer remains disabled until exact CUSA00411 / 1.73 reference files and console validation exist.

## Supported round-trip candidates

The integration attempts RPF archives plus resource files for which ragekit advertises read/write coverage: RPF, YFT, YDR, YDD, YTD, YBN, YPT, YNV, YND, YMAP, YTYP, YCD, YSC, YAW, REL, AWC, GXT2, YMF, YMT, YED, YFD, YBD, YVR, YWR and GFX. Actual support depends on the individual file and required keys/edition. Unsupported or malformed inputs return an error report and are never marked converted.

## License

AutoPort's integration glue is part of this repository. ragekit is fetched at build time under its MIT license; its own license and third-party notices remain with that upstream dependency.
