# Crown Victoria test fixture

## Classification
PC GTA V vehicle replacement for the existing `glendale` model; not a standalone add-on vehicle.

## Expected files
- `glendale.yft`
- `glendale_hi.yft`
- `glendale.ytd`
- `vehicles.meta`
- `handling.meta`
- `Readme.txt`

## Metadata observations from initial inspection
- modelName: `glendale`
- txdName: `glendale`
- handlingId: `GLENDALE`
- gameName: `GLENDALE`
- vehicle class: sedan
- wheel type: lowrider
- handling mass: 1500 kg
- drivetrain: rear-wheel drive
- gears: 5

The PC readme describes replacing files in an MP Hipster DLC archive and selectively replacing the matching metadata entry. Those are PC install paths, not PS4 deployment instructions.

## Acceptance tests
1. Recognize a replacement vehicle.
2. Confirm both model LOD files and texture dictionary exist.
3. Parse XML and locate exactly one target vehicle definition.
4. Resolve exactly one matching handling entry.
5. Preserve unrelated metadata entries.
6. Record hashes, dependencies, source paths, and unresolved PS4 conversion requirements.

Do not commit the user's uploaded binary assets to this repository; they are test inputs and redistribution rights are not established.
