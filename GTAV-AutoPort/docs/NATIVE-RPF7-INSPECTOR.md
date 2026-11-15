# Native RPF7 OPEN inspector

AutoPort includes a read-only inspector for the standard PC RPF7 OPEN variant.

It validates the RPF7 magic, OPEN marker, entry table bounds, name-table bounds, UTF-8 null-terminated names, directory child ranges, file flags, and 512-byte-block payload ranges. It returns a structured entry list and counts for downstream diagnostics.

## Compatibility boundary

The inspector intentionally rejects non-OPEN markers. In particular, it does not interpret the supplied Orbis sample's `0x0FFEFFFF` marker as OPEN and does not attempt to decrypt or decode its TOC. This inspector is not a PS4/Orbis archive reader and does not establish installability on CUSA00419 / GTA V 1.73.

## Tests

The tests round-trip the current JavaScript OPEN writer, exercise truncated structures and invalid payload offsets, and verify that an Orbis-style marker is rejected rather than guessed.
