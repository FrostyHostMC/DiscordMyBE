import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeBehaviorBlueprint } from "../src/core/nativeBehaviorBlueprint.js";

const source = `
using GTA;
using NativeUI;
public void OnTick() {
  if (Game.IsControlJustPressed(0, Control.Context)) {
    var ped = World.CreatePed(model, position);
    Function.Call(Hash.TASK_FOLLOW_TO_OFFSET_OF_ENTITY, ped, target);
    Function.Call(Hash.SET_PLAYER_WANTED_LEVEL, player, 2, false);
    Function.Call(Hash.ADD_BLIP_FOR_ENTITY, ped);
    Script.Wait(100);
  }
}
`;
test("extracts behavior requirements and PC dependencies from readable source", () => {
  const report = buildNativeBehaviorBlueprint([{ path: "HomeInvasion.cs", size: source.length, bytes: new TextEncoder().encode(source) }]);
  assert.equal(report.summary.sourceFiles, 1);
  assert.ok(report.summary.behaviorTypes >= 5);
  assert.ok(report.summary.pcRuntimeDependencies.includes("nativeui"));
  assert.ok(report.behaviors.some((item) => item.id === "ped.spawn"));
  assert.ok(report.behaviors.some((item) => item.id === "ped.ai-task"));
  assert.ok(report.behaviors.some((item) => item.id === "police.wanted"));
  assert.ok(report.requiredNativeHostApis.includes("spawnPed"));
  assert.equal(report.target.implementationStatus, "blueprint-only");
  assert.equal(report.target.updateVersion, "1.57");
  assert.deepEqual(report.target.titleIds, ["CUSA00419", "CUSA00411"]);
  assert.equal(report.target.regions.CUSA00419, "US");
  assert.equal(report.target.regions.CUSA00411, "EU");
});
test("does not pretend opaque DLL files are source code", () => {
  const report = buildNativeBehaviorBlueprint([{ path: "HomeInvasion.dll", size: 1024, bytes: new Uint8Array(1024) }]);
  assert.equal(report.summary.sourceFiles, 0);
  assert.equal(report.summary.behaviorTypes, 0);
});
test("returns an empty safe blueprint for no source files", () => {
  const report = buildNativeBehaviorBlueprint([]);
  assert.equal(report.summary.sourceFiles, 0);
  assert.equal(report.summary.detectedOccurrences, 0);
});
