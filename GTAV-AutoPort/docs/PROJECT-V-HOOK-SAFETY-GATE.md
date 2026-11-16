# Project V Runtime Hook Safety Gate

This is a host-testable safety primitive for the Project V runtime port. It deliberately does not write process memory, install detours, or claim any GTA V signature is valid.

## API

- `findUniquePattern` scans a bounded byte image using an exact/wildcard mask.
- A signature is accepted only when it occurs exactly once.
- Signed result offsets are bounds-checked, including negative offsets used by older Project V scan code.
- `validatePatchWindow` checks the expected original prologue and confirms the full requested patch window fits inside the supplied image.

## Integration rule

The eventual Project V PRX must resolve every required hook against a build-specific executable image, validate all expected bytes and patch windows, and complete an all-hooks preflight before writing any patch. A missing, ambiguous, truncated, or mismatched signature must leave the game image untouched.

The module is not yet wired into the upstream Project V detour implementation because the exact v1.2 archive and matching target executable references are not present in the repository. Do not treat these generic scanner tests as proof of 1.57 or 1.73 compatibility.
