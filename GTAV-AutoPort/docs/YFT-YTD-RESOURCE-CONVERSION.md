# YFT / YTD resource conversion

## Available writer stage

AutoPort now exposes a bounded local conversion action for `.yft`, `.ytd`, `.ydr` and `.ydd` resources through the pinned RageKit v0.3.1 CLI. The route asks RageKit to write the resource in GTA V PC Legacy edition format, then parses the output with `rk info` and runs `rk roundtrip` on the output. It reports source/output SHA-256 values and whether the second round-trip is byte-exact. The source file is never overwritten.

RageKit documents readers and writers for YFT fragments, YTD texture dictionaries, YDR drawables, YDD drawable dictionaries and YBN collision resources, including cross-edition Legacy/Enhanced conversion. Its documentation describes validation against PC Legacy and Enhanced game files and CodeWalker; it does not establish PS4 CUSA00419 update 1.57 compatibility. See [RageKit's format coverage](https://github.com/RatPrez/ragekit) and [Enhanced/Legacy conversion notes](https://github.com/RatPrez/ragekit/blob/main/docs/enhanced.md).

## What the output is

The downloadable result is a **GTA V PC Legacy-format candidate**. It is not labeled PS4-ready. A successful parse and byte-exact round-trip proves that the produced file can be read and rewritten consistently by the same PC-side backend; it does not prove the console will stream or render it.

## Remaining PS4 work

- Establish the exact PS4 CUSA00419 (US) and CUSA00411 (EU) / 1.57 YFT and YTD resource versions, page flags, compression and texture encodings from a user-owned target resource fixture.
- Compare PC Legacy output against a known-good PS4 resource and implement a separate PS4 writer/adapter if the layouts differ.
- Validate YFT drawable/physics/LOD/bone/glass structures and all referenced YTD/shader/material resources.
- Validate YTD formats, mip chains, texture dimensions, sampler expectations and all material references.
- Resolve the complete RPF/DLC mount path and resource dependency graph.
- Test the candidate in GTA V Story Mode on the exact target and preserve a rollback copy.

Until those gates pass, the UI keeps the output in a separate download and the deployment/package flow remains blocked.