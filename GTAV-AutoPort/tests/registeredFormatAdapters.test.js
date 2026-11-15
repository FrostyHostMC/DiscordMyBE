import test from "node:test";
import assert from "node:assert/strict";
import { registeredFormatAdapterRegistry } from "../src/core/registeredFormatAdapters.js";

test("RageKit writer is discovered through the adapter registry, not prep-bundle extension logic", () => {
  const file = { path: "unfamiliar-folder/model.yft", bytes: new Uint8Array([0x52, 0x53, 0x43, 0x37]) };
  const result = registeredFormatAdapterRegistry.inspect(file);
  assert.equal(result.status, "recognized");
  assert.equal(result.selectedAdapterId, "ragekit-pc-legacy-resource-writer");
  assert.ok(result.match.capabilities.includes("convert"));
});

test("unsupported resources are not routed into the RageKit writer by filename alone", () => {
  const file = { path: "unfamiliar-folder/opaque.bin", bytes: new Uint8Array([0x52, 0x53, 0x43, 0x37]) };
  const result = registeredFormatAdapterRegistry.inspect(file);
  assert.equal(result.status, "recognized");
  assert.notEqual(result.selectedAdapterId, "ragekit-pc-legacy-resource-writer");
  assert.equal(result.conversionAuthorized, false);
});
