import test from "node:test";
import assert from "node:assert/strict";
import { inspectVehicleMetadata } from "../src/core/metadata.js";

const vehiclesXml = `<?xml version="1.0"?><CVehicleModelInfo__InitDataList><InitDatas><Item><modelName>glendale</modelName><txdName>glendale</txdName><handlingId>GLENDALE</handlingId></Item><Item><modelName>other</modelName><txdName>other</txdName><handlingId>OTHER</handlingId></Item></InitDatas></CVehicleModelInfo__InitDataList>`;
const handlingXml = `<?xml version="1.0"?><CHandlingDataMgr><HandlingData><Item><handlingName>GLENDALE</handlingName><fMass>1500.0</fMass></Item><Item><handlingName>OTHER</handlingName></Item></HandlingData></CHandlingDataMgr>`;

test("selects the requested vehicle and its matching handling entry", () => {
  const result = inspectVehicleMetadata({ vehiclesXml, handlingXml, modelName: "glendale" });
  assert.equal(result.modelName, "glendale");
  assert.equal(result.handlingId, "GLENDALE");
  assert.equal(result.handlingEntry.handlingName, "GLENDALE");
  assert.deepEqual(result.dependencies.modelFiles, ["glendale.yft", "glendale_hi.yft"]);
  assert.deepEqual(result.dependencies.textureFiles, ["glendale.ytd"]);
});

test("rejects a missing vehicle entry", () => {
  assert.throws(() => inspectVehicleMetadata({ vehiclesXml, handlingXml, modelName: "missing" }), /found 0/);
});

test("rejects duplicate vehicle entries", () => {
  const duplicate = vehiclesXml.replace("</InitDatas>", "<Item><modelName>glendale</modelName><txdName>glendale</txdName><handlingId>GLENDALE</handlingId></Item></InitDatas>");
  assert.throws(() => inspectVehicleMetadata({ vehiclesXml: duplicate, handlingXml, modelName: "glendale" }), /found 2/);
});

test("rejects missing handling reference", () => {
  const broken = vehiclesXml.replace("<handlingId>GLENDALE</handlingId>", "<handlingId>UNKNOWN</handlingId>");
  assert.throws(() => inspectVehicleMetadata({ vehiclesXml: broken, handlingXml, modelName: "glendale" }), /UNKNOWN/);
});
