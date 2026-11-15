import test from "node:test";
import assert from "node:assert/strict";
import { FormatAdapterRegistry } from "../src/core/formatAdapterRegistry.js";

const bytes = (...values) => new Uint8Array(values);

test("adapter recognition is based on evidence, not mod names or folder names", () => {
  const registry = new FormatAdapterRegistry([{
    id: "test-magic-format",
    version: "1",
    capabilities: ["inspect"],
    probe(file) {
      return file.bytes[0] === 0x41
        ? { match: true, confidence: 0.99, role: "test-asset", evidence: ["magic byte 0x41"] }
        : { match: false };
    }
  }]);
  const result = registry.inspect({ path: "random-folder/unfamiliar-name.bin", bytes: bytes(0x41, 0x42) });
  assert.equal(result.status, "recognized");
  assert.equal(result.selectedAdapterId, "test-magic-format");
  assert.equal(result.preservedAsSource, true);
  assert.equal(result.conversionAuthorized, false);
});

test("unknown formats remain preserved and are not guessed", () => {
  const registry = new FormatAdapterRegistry();
  const result = registry.inspect({ path: "new-format.asset", bytes: bytes(0, 1, 2) });
  assert.equal(result.status, "unrecognized");
  assert.equal(result.selectedAdapterId, null);
  assert.equal(result.preservedAsSource, true);
});

test("equal evidence and priority produces an explicit ambiguity", () => {
  const probe = () => ({ match: true, confidence: 0.8, evidence: ["same signature"] });
  const registry = new FormatAdapterRegistry([{ id: "one", probe }, { id: "two", probe }]);
  const result = registry.inspect({ path: "asset.bin", bytes: bytes(1) });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.selectedAdapterId, null);
});

test("bad adapter probes are isolated and reported", () => {
  const registry = new FormatAdapterRegistry([
    { id: "broken", probe() { throw new Error("bad parser"); } },
    { id: "working", probe() { return { match: true, confidence: 1 }; } }
  ]);
  const result = registry.inspect({ path: "asset.bin", bytes: bytes(1) });
  assert.equal(result.status, "recognized");
  assert.deepEqual(result.probeErrors, [{ adapterId: "broken", error: "bad parser" }]);
});

test("conversion requires an unambiguous adapter and byte output", async () => {
  const registry = new FormatAdapterRegistry([{
    id: "writer",
    probe() { return { match: true, confidence: 1 }; },
    async convert() { return { bytes: bytes(9), targetCompatibility: "test-only" }; }
  }]);
  const file = { path: "asset.bin", bytes: bytes(1) };
  const inspection = registry.inspect(file);
  const output = await registry.convert(inspection, file);
  assert.equal(output.adapterId, "writer");
  assert.equal(output.targetCompatibility, "test-only");
  assert.equal(output.installable, false);
  await assert.rejects(() => registry.convert({ status: "ambiguous" }, file), /unambiguous/);
});

test("duplicate adapter ids and invalid confidence are rejected", () => {
  const probe = () => ({ match: true, confidence: 1.2 });
  assert.throws(() => new FormatAdapterRegistry([{ id: "dup", probe }, { id: "dup", probe }]), /Duplicate/);
  const registry = new FormatAdapterRegistry([{ id: "bad-confidence", probe }]);
  assert.equal(registry.inspect({ path: "x", bytes: bytes(1) }).status, "unrecognized");
  assert.equal(registry.inspect({ path: "x", bytes: bytes(1) }).probeErrors[0].adapterId, "bad-confidence");
});
