# Executable header inspection

AutoPort now inspects executable bytes for native plugin candidates instead of trusting only the file extension.

## Formats

- **PE (MZ):** validates the DOS-to-PE header offset, PE signature, machine, section count, optional-header width and selected metadata flags. A PE image named .prx/.sprx is flagged as a Windows binary mismatch.
- **ELF:** validates class, byte order, version, declared header size and bounded program-header table; reports machine, object type, entry point, flags and load-segment summaries. ELF64 little-endian x86-64 is only a CPU-architecture match clue.
- **Sony SCE:** recognizes the SCE container magic but deliberately treats the payload as opaque.

The same evidence is attached to mod inventory and the PS4 delivery plan. A PE or wrong-architecture ELF can be blocked early; a readable x86-64 ELF remains target-validation-required.

## What this does not prove

A readable ELF header does not establish Orbis ABI, SELF/SPRX signature validity, imports, relocation behavior, GoldHEN loader compatibility, title ID, game update, offsets or safe execution. SCE containers are not decrypted or authenticated. The inspector does not patch or execute binaries.

## Bounds and tests

- Reads only the supplied file bytes; no external tool or process is launched.
- Limits ELF program-header inspection to 256 entries.
- Checks program-header table and segment numeric ranges.
- Regression fixtures cover valid PE/ELF headers, wrong architecture, truncated tables, opaque SCE magic and unknown data.

The result is diagnostic evidence only. It cannot upgrade any file to PS4-ready or installable.
