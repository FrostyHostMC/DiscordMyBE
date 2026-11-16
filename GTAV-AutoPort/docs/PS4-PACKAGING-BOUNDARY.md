# PS4 package builder — current boundary

The first package writer produces a GoldHEN AFR handoff for **complete, already-built PS4 RPF7 archives only**. It preserves the archive bytes, hashes each source, creates the title-specific AFR directory tree, and emits a mergeable `plugins.ini.snippet` plus installation notes.

## Mandatory gates

- User confirms the RPF archive itself is already built for the target PS4 GTA V build.
- User confirms every exact `/app0/...` destination path for that title/update.
- Only complete `.rpf` files with an `RPF7` signature are accepted.
- Unsafe paths and duplicate destinations are rejected.
- No PC archive is relabeled, no resource is rewritten, and no plugin binary is fabricated.

## Explicitly not implemented

This is **not yet a PC-to-PS4 resource converter**. It does not convert PC YFT/YTD/YDR/YBN resources, construct PS4 RPF archives, generate SPRX binaries, or validate the user's CUSA00419 / 1.57 AFR file-open path. The app must keep those cases blocked rather than exporting a misleading "ready" package.

The next genuine conversion milestone is a PS4-specific RAGE resource writer and a verified 1.57 archive/container insertion path. A PC RAGE round-trip is not sufficient evidence.
