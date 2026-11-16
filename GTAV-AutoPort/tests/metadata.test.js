import test from "node:test";
import assert from "node:assert/strict";
import { inspectVehicleMetadata, listVehicleModels } from "../src/core/metadata.js";

const vehiclesXml = `<?xml version="1.0"?><CVehicleModelInfo__InitDataList><InitDatas><Item><modelName>glendale</modelName><txdName>glendale</txdName><handlingId>GLENDALE</handlingId><audioNameHash>GLENDALE</audioNameHash><cameraName>FOLLOW_VEHICLE_CAMERA</cameraName><vehicleClass>VC_SEDAN</vehicleClass></Item><Item><modelName>other</modelName><txdName>other</txdName><handlingId>OTHER</handlingId></Item></InitDatas></CVehicleModelInfo__InitDataList>`;
const handlingXml = `<?xml version="1.0"?><CHandlingDataMgr><HandlingData><Item><handlingName>GLENDALE</handlingName><fMass>1500.0</fMass><fInitialDriveForce>0.25</fInitialDriveForce><fBrakeForce>0.8</fBrakeForce><fTractionCurveMax>2.4</fTractionCurveMax></Item><Item><handlingName>OTHER</handlingName></Item></HandlingData></CHandlingDataMgr>`;

test("selects the requested vehicle and its matching handling entry", () => {
  const result = inspectVehicleMetadata({ vehiclesXml, handlingXml, modelName: "glendale" });
  assert.equal(result.modelName, "glendale");
  assert.equal(result.handlingId, "GLENDALE");
  assert.equal(result.handlingEntry.handlingName, "GLENDALE");
  assert.deepEqual(result.dependencies.modelFiles, ["glendale.yft", "glendale_hi.yft"]);
  assert.deepEqual(result.dependencies.textureFiles, ["glendale.ytd"]);
});


test("maps vehicle audio, camera and grouped handling settings while preserving source fields", () => {
  const result = inspectVehicleMetadata({ vehiclesXml, handlingXml, modelName: "glendale" });
  assert.equal(result.audioReference.value, "GLENDALE");
  assert.equal(result.audioReference.resolution, "game-reference-not-yet-resolved");
  assert.equal(result.cameraReference.value, "FOLLOW_VEHICLE_CAMERA");
  assert.equal(result.mappedSettings.vehicle.identity.vehicleClass, "VC_SEDAN");
  assert.equal(result.mappedSettings.vehicle.audio.audioNameHash, "GLENDALE");
  assert.equal(result.mappedSettings.vehicle.camera.cameraName, "FOLLOW_VEHICLE_CAMERA");
  assert.equal(result.mappedSettings.handling.massAndAero.fMass, "1500.0");
  assert.equal(result.mappedSettings.handling.drivetrain.fInitialDriveForce, "0.25");
  assert.equal(result.mappedSettings.handling.brakesAndSteering.fBrakeForce, "0.8");
  assert.equal(result.mappedSettings.handling.traction.fTractionCurveMax, "2.4");
  assert.equal(result.unmodifiedSourceMetadata.preservation, "all-source-fields-retained");
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

test("discovers model names from arbitrary vehicles.meta entries", () => {
  assert.deepEqual(listVehicleModels(vehiclesXml), ["glendale", "other"]);
});
