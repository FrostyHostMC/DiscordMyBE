# Native RPF7 writer foundation

AutoPort now has a pure JavaScript RPF7 writer for the standard unencrypted **OPEN** archive variant. It creates the 16-byte header, 16-byte directory/file TOC entries, null-terminated name table, 512-byte-aligned payload offsets and stored (uncompressed) file payloads.

## Deliberate limits

- This writer is for standard little-endian PC RPF7 OPEN archives only.
- It does not reproduce the Orbis builder's encrypted PS4 output.
- RSC7 resources are rejected because a valid resource entry requires system/graphics page flags; writing them as generic binary entries would produce a misleading archive.
- The 23-bit block-offset limit is enforced, and paths are checked against traversal, absolute paths, duplicate names and file/directory collisions.
- Output is labeled non-installable until target-specific validation is complete.

## Orbis reference finding

The supplied Orbis sample starts with bytes `37 46 50 52` (little-endian RPF7 magic), entry count 5, name-table length 48, and a nonstandard fourth header word `0x0FFEFFFF`. Its TOC/name region is not plaintext. The sample's two source files and Lua script establish the requested archive paths, but they do not disclose the Orbis TOC encryption/encoding algorithm. AutoPort must not emit a fake PS4 archive by substituting OPEN for this marker.
