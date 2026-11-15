# Vehicle metadata mapping

AutoPort's vehicle metadata stage resolves the selected `vehicles.meta` item to exactly one `handling.meta` item using `handlingId`. It preserves both complete parsed source entries and creates grouped mappings for fields commonly used by vehicle definitions.

## Mapped groups

- Vehicle identity: model name, texture dictionary, handling ID, game/make/class identifiers and plate/type values.
- Audio: `audioNameHash` is surfaced as a game-audio reference. The matching audio bank/event is not considered resolved merely because the name exists.
- Camera: camera name/hash and first-person drive-by data are surfaced as references. A camera name does not prove a matching PS4 camera handler exists.
- Layout/animation, appearance/equipment and streaming/LOD fields are grouped when present.
- Handling: mass/aerodynamics, drivetrain, brakes/steering, traction, suspension and damage/fuel/other values.

Unknown or mod-specific fields remain available in `vehicleEntry`, `handlingEntry`, and `unmodifiedSourceMetadata`; the mapper does not discard them.

## Dependency checks

The existing dependency graph links the selected model's YFT/high-LOD YFT and TXD/YTD names, plus the handling metadata file. Audio and camera references are reported as unresolved game references until their actual target resources or runtime handlers are independently identified.

## PS4 gate

This stage is metadata extraction and mapping only. It does not rewrite metadata into a PS4 DLC, create missing audio banks, rebuild camera handlers, or certify vehicle physics. Resource writers, exact target schemas, reference resolution and in-game CUSA00419 / 1.73 validation remain required.