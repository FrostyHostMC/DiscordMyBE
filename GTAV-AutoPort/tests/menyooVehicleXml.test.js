import test from "node:test";
import assert from "node:assert/strict";
import { buildMenyooVehiclePackExport, translateMenyooVehicleXml } from "../src/core/menyooVehicleXml.js";

const sample = `<?xml version="1.0" encoding="UTF-8"?>
<SpoonerPlacements>
  <Placement>
    <ModelHash>0x9b909c94</ModelHash>
    <HashName>sabregt</HashName>
    <Type>Vehicle</Type>
    <PositionRotation>
      <Position><X>12.5</X><Y>-4</Y><Z>8.25</Z></Position>
      <Rotation><X>0</X><Y>0</Y><Z>90</Z></Rotation>
      <Heading>90</Heading>
    </PositionRotation>
    <VehicleProperties><PrimaryColor>12</PrimaryColor><Livery>2</Livery></VehicleProperties>
    <SpoonerAttachments>
      <Attachment><ModelHash>0x1234</ModelHash><HashName>prop_minigun_01</HashName><Bone>chassis</Bone>
        <Position><X>0.1</X><Y>1.2</Y><Z>0.3</Z></Position>
        <Rotation><X>0</X><Y>0</Y><Z>15</Z></Rotation>
      </Attachment>
    </SpoonerAttachments>
  </Placement>
</SpoonerPlacements>`;

test("translates Menyoo vehicle identity, transform, properties and attachments", () => {
  const report = translateMenyooVehicleXml(sample, "vehicles/sabregt.xml");
  assert.equal(report.validXml, true);
  assert.equal(report.format, "menyoo-spooner-vehicle-xml");
  assert.equal(report.summary.vehicleCount, 1);
  assert.equal(report.summary.attachmentCount, 1);
  const vehicle = report.vehicles[0];
  assert.equal(vehicle.modelName, "sabregt");
  assert.equal(vehicle.modelHash.unsigned32, 0x9b909c94);
  assert.deepEqual(vehicle.transform.position, { x: 12.5, y: -4, z: 8.25 });
  assert.deepEqual(vehicle.transform.rotation, { x: 0, y: 0, z: 90 });
  assert.equal(vehicle.transform.heading, 90);
  assert.equal(vehicle.attachments[0].model, "prop_minigun_01");
  assert.equal(vehicle.attachments[0].bone, "chassis");
  assert.equal(vehicle.vehicleProperties.PrimaryColor, "12");
  assert.equal(vehicle.conversion.spawnReady, false);
});

test("exports loss-preserving intermediate pack without claiming PS4 readiness", () => {
  const report = translateMenyooVehicleXml(sample);
  const pack = buildMenyooVehiclePackExport(report);
  assert.equal(pack.format, "autoport-menyoo-vehicle-pack");
  assert.equal(pack.vehicles.length, 1);
  assert.equal(pack.compatibility, "intermediate-data-only");
  assert.ok(pack.requirements.includes("attachment creation and bone/offset mapping"));
  assert.throws(() => buildMenyooVehiclePackExport({ validXml: false }), /valid Menyoo/);
});

test("invalid XML is reported and does not emit vehicle entries", () => {
  const report = translateMenyooVehicleXml("<SpoonerPlacements><Placement>");
  assert.equal(report.validXml, false);
  assert.equal(report.vehicles.length, 0);
});

test("unrelated XML with no vehicle placements remains an empty valid report", () => {
  const report = translateMenyooVehicleXml("<Config><Enabled>true</Enabled></Config>");
  assert.equal(report.validXml, true);
  assert.equal(report.summary.vehicleCount, 0);
});
