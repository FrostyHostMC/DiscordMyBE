import test from "node:test";
import assert from "node:assert/strict";
import { compileMenyooNativeActionPlan } from "../src/core/nativeActionPlan.js";

const report = {
  validXml: true,
  format: "menyoo-spooner-vehicle-xml",
  target: { titleId: "CUSA00419", updateVersion: "1.73" },
  vehicles: [{
    id: "vehicle-1", modelName: "adder", modelHash: { raw: "0xB779A091", unsigned32: 3078201489 },
    transform: { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 90 }, heading: 90 },
    attachments: [{ model: "prop_minigun_01", modelHash: { raw: "123", unsigned32: 123 }, bone: "chassis", position: { x: 0, y: 1, z: 2 }, rotation: { x: 0, y: 0, z: 0 } }],
    vehicleProperties: { Livery: "2", EngineHealth: "900", UnknownField: "kept" },
  }],
};

test("compiles saved vehicle, placement, attachment and known vehicle properties", () => {
  const plan = compileMenyooNativeActionPlan(report);
  assert.equal(plan.summary.spawns, 2);
  assert.equal(plan.summary.transforms, 1);
  assert.equal(plan.summary.attachments, 1);
  assert.equal(plan.summary.vehicleProperties, 2);
  assert.equal(plan.actions[0].op, "spawn_entity");
  assert.equal(plan.actions[1].op, "set_transform");
  assert.equal(plan.actions.find((action) => action.op === "attach_entity").bone, "chassis");
  assert.equal(plan.execution.status, "adapter-required");
  assert.equal(plan.execution.executable, false);
  assert.equal(plan.unsupportedProperties[0].key, "UnknownField");
});

test("does not invent missing transforms or attachment offsets", () => {
  const incomplete = structuredClone(report);
  incomplete.vehicles[0].transform = { position: null, rotation: null, heading: null };
  incomplete.vehicles[0].attachments[0].position = null;
  const plan = compileMenyooNativeActionPlan(incomplete);
  assert.ok(plan.execution.blockers.some((message) => message.includes("placement is incomplete")));
  assert.ok(plan.execution.blockers.some((message) => message.includes("confirmed bone plus offset")));
  assert.equal(plan.summary.attachments, 0);
});

test("rejects unrelated report formats", () => {
  assert.throws(() => compileMenyooNativeActionPlan({ validXml: true, format: "other", vehicles: [] }), /valid Menyoo vehicle report/);
});
