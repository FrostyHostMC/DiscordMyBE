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


function makeDds(fourCC = "DXT1") {
  const bytes = new Uint8Array(136);
  bytes.set([0x44, 0x44, 0x53, 0x20]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 124, true);
  view.setUint32(8, 0x81007, true);
  view.setUint32(12, 4, true);
  view.setUint32(16, 4, true);
  view.setUint32(28, 1, true);
  view.setUint32(76, 32, true);
  view.setUint32(80, 4, true);
  for (let i = 0; i < 4; i++) bytes[84 + i] = fourCC.charCodeAt(i);
  view.setUint32(112, 0x1000, true);
  for (let i = 128; i < bytes.length; i++) bytes[i] = i;
  return bytes;
}

test("discovers and executes the experimental PS4 DDS storage adapter by content signature", async () => {
  const file = { path: "textures/custom-name.bin", bytes: makeDds() };
  const inspection = registeredFormatAdapterRegistry.inspect(file);
  assert.equal(inspection.status, "recognized");
  assert.equal(inspection.selectedAdapterId, "ps4-thin1dthin-dds-storage");
  assert.ok(inspection.match.capabilities.includes("ps4-texture-storage"));
  const output = await registeredFormatAdapterRegistry.convert(inspection, file);
  assert.equal(output.adapterId, "ps4-thin1dthin-dds-storage");
  assert.equal(output.bytes.length, output.layout.storageBytes);
  assert.equal(output.roundtripVerified, true);
  assert.equal(output.installable, false);
  assert.equal(output.targetCompatibility, "experimental storage-layout conversion only; not a complete PS4 RSC7/YTD texture dictionary");
});

test("keeps unsupported DDS compression out of the PS4 storage writer", async () => {
  const file = { path: "textures/unsupported.dds", bytes: makeDds("DXT3") };
  const inspection = registeredFormatAdapterRegistry.inspect(file);
  assert.equal(inspection.selectedAdapterId, "ps4-thin1dthin-dds-storage");
  await assert.rejects(() => registeredFormatAdapterRegistry.convert(inspection, file), /Only BC1/);
});
