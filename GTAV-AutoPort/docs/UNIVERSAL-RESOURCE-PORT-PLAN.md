# Universal resource port planning

This module is the next step after intake classification: it turns the imported inventory into a deterministic, family-specific work plan without pretending that source parsing equals conversion.

## What it does
- Routes RPF archives, RAGE resources, metadata, maps, animation, particles, audio, source models, textures, scripts and native plugins into explicit pipeline stages.
- Reports the currently known source-side capability and target-side gap for each file.
- Marks PC-native plugins and source scripts as behavior-reimplementation work, not file-copy work.
- Groups same-basename model/texture/collision files as **candidate relationships** only. It does not silently convert a filename match into a dependency edge.
- Produces per-stage work queues and a blocker summary for the selected PS4 target.

## What it does not do
- It does not decode or rewrite resources.
- It does not build RPF/DLC archives or a PS4 install package.
- It does not treat ragekit's Legacy/Enhanced writers as PS4 writers.
- It does not claim that YFT/YTD co-location proves a dependency.

## Next adapter sequence
1. Pin and build a native backend behind a versioned adapter contract.
2. Run source decode + write + re-read round trips for each supported format.
3. Obtain lawful reference resources from the exact target build and identify resource layout differences.
4. Implement and test a PS4-specific writer for one family at a time.
5. Validate in-game behavior and rollback before enabling packaging.

The initial vehicle regression should remain a fixture, not a hard-coded conversion path. Maps, peds, props, weapons and audio must enter through the same resource inventory and adapter registry.
