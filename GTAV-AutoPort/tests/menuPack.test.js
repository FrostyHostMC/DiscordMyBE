import test from "node:test";
import assert from "node:assert/strict";
import { inspectMenuRelatedFiles, inspectSynapseMenuPack, inspectVehicleXmlPreset } from "../src/core/menuPack.js";

const encoder = new TextEncoder();
const file = (path, value) => ({ path, bytes: encoder.encode(value) });

test("counts Synapse catalogs and reads title-specific GoldHEN entries", () => {
  const report = inspectSynapseMenuPack([
    file("synapse/plugins.ini", "[CUSA00419]\n/data/GoldHEN/plugins/synapse.sprx\n"),
    file("synapse/synapse/files/vehicles.json", JSON.stringify({ super: ["adder", "t20"], sports: ["sultan"] })),
    file("synapse/synapse/files/objects.json", JSON.stringify(["prop_roadcone01a"])),
    file("synapse/synapse.sprx", "binary placeholder"),
  ]);
  assert.equal(report.summary.catalogFiles, 2);
  assert.equal(report.summary.catalogItems, 3);
  assert.equal(report.targetPlugins.length, 1);
  assert.equal(report.hasSynapseBinary, true);
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
