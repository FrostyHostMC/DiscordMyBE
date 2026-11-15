# Orbis RPF Builder integration (initial)

AutoPort now has a source-controlled recipe generator based on the user-supplied
`Orbis-RPF-Builder.zip` example. The supplied `archive_builder.lua` uses
`set_platform("orbis")`, `start_uncompressed_pack()`, `add_to_pack()`,
`save_pack()` and `close_pack()`. The supplied `build.bat` invokes
`ragebuilder_x64_0378.exe` with the Lua script.

## What AutoPort implements

`src/core/orbisRpfBuilder.js` validates relative archive paths, rejects traversal,
absolute paths and duplicate destinations, and generates an `archive_builder.lua`
and Windows `build.bat` for a selected file manifest. It generates the recipe
only; it does not itself encode or convert resource files.

## Use

```js
import { createOrbisRpfBuildPlan } from "./src/core/orbisRpfBuilder.js";
const plan = createOrbisRpfBuildPlan([
  { path: "content.xml", size: 5674 },
  { path: "common/data/handling.meta", size: 786912 }
], "vehicle_pack.rpf");
console.log(plan.lua, plan.batch);
```

Place source files under `archive_input/` using the same relative paths, place a
legally obtained `ragebuilder_x64_0378.exe` beside the generated scripts, and
run `build.bat` on Windows. The executable and support DLLs are not redistributed.

## Compatibility boundary

The sample selects the Orbis platform and creates an uncompressed RPF archive.
That does not prove arbitrary PC resources become PS4-compatible. AutoPort keeps
`verifiedOnConsole: false` and `installable: false`. For CUSA00419 / GTA V 1.73,
archive layout, resource encodings, DLC registration, runtime hooks and console
acceptance remain separate validation gates.

## Provenance and licensing

The supplied ZIP contains instructions and an example Lua script but no license
file. AutoPort reimplements the small documented script-generation behavior and
does not copy or bundle the EXE or DLLs. Confirm licenses before redistribution.
