import test from "node:test";
import assert from "node:assert/strict";
import { inspectMenuRelatedFiles, inspectSynapseMenuPack, inspectVehicleXmlPreset } from "../src/core/menuPack.js";

const encoder = new TextEncoder();
const file = (path, value) => ({ path, bytes: encoder.encode(value), size: encoder.encode(value).length });

test("inspects Synapse catalogs, settings, SELF signature and title-specific GoldHEN entries", () => {
  const sprx = { path: "synapse/synapse.sprx", bytes: new Uint8Array([0x4f, 0x15, 0x3d, 0x1d, 0x00]), size: 5 };
  const report = inspectSynapseMenuPack([
    file("synapse/plugins.ini", "[CUSA00419]\n/data/GoldHEN/plugins/synapse.sprx\n[CUSA57548]\n/data/GoldHEN/plugins/t6.sprx\n"),
    file("synapse/synapse/files/vehicles.json", JSON.stringify({ super: ["adder", "t20"], sports: ["sultan"] })),
    file("synapse/synapse/files/objects.json", JSON.stringify(["prop_roadcone01a"])),
    file("synapse/synapse/files/settings.ini", "[menu]\nx = 0.13\n[theme]\nrainbow_mode = true\n"),
    sprx,
  ]);
  assert.equal(report.summary.catalogFiles, 2);
  assert.equal(report.summary.catalogItems, 4);
  assert.equal(report.targetPlugins.length, 1);
  assert.equal(report.plugins.length, 2);
  assert.equal(report.summary.settingsSections, 2);
  assert.equal(report.summary.settingsValues, 2);
  assert.equal(report.sprxHeader.isPs4SelfContainer, true);
});

test("treats a zero-byte catalog as an empty placeholder, not invalid JSON", () => {
  const report = inspectSynapseMenuPack([
    file("synapse/plugins.ini", "[CUSA00419]\n/data/GoldHEN/plugins/synapse.sprx\n"),
    file("synapse/synapse/files/teleports.json", ""),
  ]);
  assert.equal(report.catalogs[0].state, "empty-placeholder");
  assert.equal(report.summary.emptyCatalogs, 1);
  assert.equal(report.summary.invalidCatalogs, 0);
});

test("counts duplicate catalog entries and reports them", () => {
  const report = inspectSynapseMenuPack([
    file("synapse/plugins.ini", "[CUSA00419]\n/data/GoldHEN/plugins/synapse.sprx\n"),
    file("synapse/synapse/files/vehicles.json", JSON.stringify({ cars: ["adder", "adder"] })),
  ]);
  assert.equal(report.summary.duplicateEntries, 1);
  assert.equal(report.catalogs[0].duplicates[0].value, "adder");
});

test("recognizes Menyoo vehicle XML but does not claim Synapse compatibility", () => {
  const result = inspectVehicleXmlPreset(file("vehicles/test.xml", '<Vehicle menyoo_ver="0.999"><ModelHash>1234</ModelHash><SpoonerAttachments><Attachment><ModelHash>5678</ModelHash></Attachment></SpoonerAttachments><TaskSequence><Task/></TaskSequence></Vehicle>'));
  assert.equal(result.validXml, true);
  assert.equal(result.format, "menyoo-spooner-vehicle-xml");
  assert.equal(result.modelHash, "1234");
  assert.equal(result.compatibility, "source-parsed-target-schema-unverified");
});

test("invalid XML is returned as a report", () => {
  const result = inspectVehicleXmlPreset(file("bad.xml", "<Vehicle><broken></Vehicle>"));
  assert.equal(result.validXml, false);
});

test("returns an empty summary for unrelated imports", () => {
  const result = inspectMenuRelatedFiles([file("readme.txt", "hello")]);
  assert.equal(result.summary.hasSynapsePack, false);
  assert.equal(result.summary.xmlFiles, 0);
});
