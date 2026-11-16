# Native RPF7 OPEN inspector

AutoPort includes a read-only inspector for the standard PC RPF7 OPEN variant.

It validates the RPF7 magic, OPEN marker, entry table bounds (250,000 entries by default), name-table bounds, UTF-8 null-terminated names, directory child ranges and parent-cycle detection, file flags, and 512-byte-block payload ranges. Parent-cycle checks are linear in the TOC size. Reconstructed paths reject traversal, Windows device names, control characters and Windows-invalid characters, and are bounded to 4,096 characters per path and 64 MiB cumulatively. It reconstructs each entry path from the validated directory hierarchy. The companion `extractOpenRpf7` API returns copied raw file payloads with those paths; it does not decode or convert the payload formats. Extraction defaults to at most 5,000 files and 512 MiB of total expanded payload bytes, and checks both limits before copying any payload. Callers can supply stricter or explicitly larger limits.

## Compatibility boundary

The inspector intentionally rejects non-OPEN markers. In particular, it does not interpret the supplied Orbis sample's `0x0FFEFFFF` marker as OPEN and does not attempt to decrypt or decode its TOC. This inspector is not a PS4/Orbis archive reader and does not establish installability on CUSA00419 / GTA V 1.57.

## Tests

The tests round-trip the current JavaScript OPEN writer, exercise truncated structures and invalid payload offsets, verify that an Orbis-style marker is rejected rather than guessed, check nested raw extraction and path reconstruction, verify that file-count/expanded-byte limits reject oversized extraction before copying, and reject unsafe Windows paths and TOCs above the configured entry limit.
