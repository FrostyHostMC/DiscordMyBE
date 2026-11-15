# Universal evidence-based format adapter registry

## Purpose

AutoPort must not encode knowledge of individual mods, mod authors, vehicle names,
graphics packs, sample filenames, or one creator's directory layout into its core.
The core coordinates independent format adapters; each adapter identifies a
format from evidence in the file and declares what it can actually do.

## Contract

```js
{
  id: "stable-format-id",
  version: "adapter-version",
  description: "What this adapter supports",
  capabilities: ["inspect", "extract", "convert"],
  priority: 0,
  probe(file, context) {
    // Return { match, confidence, role, evidence, capabilities }.
    // Inspect signatures/structure and validated metadata, not mod identity.
  },
  async convert(file, context) {
    // Optional. Return { bytes: Uint8Array, targetCompatibility, installable }.
  }
}
```

## Safety and selection

- Probes receive a bounded byte prefix, normalized extension, relative path and size.
- Extensions are hints, never sufficient proof of a format by themselves.
- Each adapter returns confidence and human-readable evidence.
- Equal top confidence/priority matches are marked ambiguous; no adapter is silently chosen.
- A probe exception is isolated and reported; it cannot prevent other adapters from inspecting the file.
- Unknown files remain source-preserved and explicitly unrecognized.
- Recognition does not authorize conversion. Conversion requires one unambiguous adapter with a writer.
- A writer must return bytes. Its target compatibility defaults to `unverified`; installability is false unless explicitly established by a validated adapter.
- Adapters are registered independently, so adding support for a new RAGE format does not require changing core intake logic.

## Current boundary

This registry is a reusable foundation and is not itself a universal GTA V converter.
Existing format-specific writers still need to be wrapped as adapters, with fixtures
and target evidence. The PC RPF7 OPEN writer and PC Legacy resource writer must remain
explicitly distinct from Orbis/PS4 output. No mod-specific exception should be added
to the registry to make a single sample pass.

## Intake integration

The automatic mod audit now runs the default content-signature adapters on every
imported file with available bytes. The initial signature adapters identify RSC7,
little-endian RPF7, DDS, PNG, RIFF/WAVE, Ogg, Windows PE and ELF. These are
format probes, not claims of complete parsers or writers.

When an extension is unknown but a signature is recognized, the intake can infer
a broad asset family from the signature role. When an extension is known but its
content does not match the expected signature, the report keeps the extension
classification as a hint and separately reports the missing content recognition.
The report includes `classificationBasis` and the full `formatDetection` result
so downstream stages can distinguish hints from content evidence.

The generic registry remains the extension point for additional adapters. New
format support should be added by registering an adapter with format evidence and
its own independently tested capabilities—not by adding a special case for a
specific mod package.
