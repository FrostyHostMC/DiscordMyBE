import test from "node:test";
import assert from "node:assert/strict";
import { buildVehiclePortReport } from "../src/core/vehiclePortReport.js";

const xml = (value) => new TextEncoder().encode(value);
const files = [
  { path: "data/vehicles.meta", bytes: xml(`<CVehicleModelInfo__InitDataList><InitDatas><Item><modelName>glendale</modelName><txdName>glendale</txdName><handlingId>GLENDALE</handlingId><audioNameHash>GLENDALE</audioNameHash><cameraName>FOLLOW_VEHICLE_CAMERA</cameraName><layout>LAYOUT_STANDARD</layout></Item></InitDatas></CVehicleModelInfo__InitDataList>`) },
  { path: "data/handling.meta", bytes: xml(`<CHandlingDataMgr><HandlingData><Item><handlingName>GLENDALE</handlingName><fMass>1500</fMass><fInitialDriveForce>0.25</fInitialDriveForce></Item></HandlingData></CHandlingDataMgr>`) },
  { path: "data/carvariations.meta", bytes: xml(`<CVehicleModelInfoVariation><variationData><Item><modelName>glendale</modelName><colors><Item>1</Item></colors><kits><Item>0_default_modkit</Item></kits></Item></variationData></CVehicleModelInfoVariation>`) },
  { path: "data/carcols.meta", bytes: xml(`<CVehicleModelInfoVarGlobal><Kits><Item><kitName>0_default_modkit</kitName></Item></Kits></CVehicleModelInfoVarGlobal>`) },
  { path: "stream/glendale.yft", bytes: new Uint8Array([1]) },
  { path: "stream/glendale_hi.yft", bytes: new Uint8Array([2]) },
  { path: "stream/glendale.ytd", bytes: new Uint8Array([3]) },
  { path: "stream/audio/glendale.awc", bytes: new Uint8Array([4]) },
];

test("resolves vehicle, handling, variation, layout, model and texture dependencies", () => {
  const report = buildVehiclePortReport({ files, modelName: "GLENDALE" });
  assert.equal(report.modelName, "glendale");
  assert.equal(report.references.handling.resolved, true);
  assert.equal(report.references.textureDictionary.resolved, true);
  assert.equal(report.references.audio.resolution, "candidate-file-match");
  assert.equal(report.references.vehicleLayout.resolution, "not-found-or-schema-different");
  assert.equal(report.references.variationKitReferences[0].value, "0_default_modkit");
  assert.equal(report.validation.readyForResourceConversion, false);
  assert.equal(report.assets.mainFragment.length, 1);
  assert.equal(report.assets.highFragment.length, 1);
  assert.equal(report.assets.textureDictionary.length, 1);
});

test("reports missing required texture and optional high fragment without guessing", () => {
  const reduced = files.filter((file) => !file.path.endsWith(".ytd") && !file.path.endsWith("_hi.yft"));
  const report = buildVehiclePortReport({ files: reduced, modelName: "glendale" });
  assert.deepEqual(report.validation.requiredMissing, ["glendale.ytd"]);
  assert.ok(report.validation.unresolved.some((message) => message.includes("High-detail fragment")));
  assert.equal(report.references.textureDictionary.resolved, false);
});

test("rejects ambiguous duplicate handling records", () => {
  const duplicated = [...files];
  duplicated[1] = { ...files[1], bytes: xml(`<CHandlingDataMgr><HandlingData><Item><handlingName>GLENDALE</handlingName></Item><Item><handlingName>GLENDALE</handlingName></Item></HandlingData></CHandlingDataMgr>`) };
  assert.throws(() => buildVehiclePortReport({ files: duplicated, modelName: "glendale" }), /found 2/);
});

test("rejects a missing target vehicle", () => {
  assert.throws(() => buildVehiclePortReport({ files, modelName: "not_here" }), /found 0/);
});
