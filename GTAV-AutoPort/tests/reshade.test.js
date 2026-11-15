import test from "node:test";
import assert from "node:assert/strict";
import { inspectReshadeMod } from "../src/core/reshade.js";
const file = (path, text) => ({ path, bytes: new TextEncoder().encode(text), size: text.length });
test("inspects effects, includes, uniforms and likely effect families", () => {
  const r = inspectReshadeMod([file("Shaders/Color.fx", '#include "Common.fxh"\nuniform float Exposure;\ntechnique ColorGrade { }\n// bloom vibrance'), file("Shaders/Common.fxh", "float helper;"), file("ReShade.ini", "[GENERAL]"), file("dxgi.dll", "MZ")]);
  assert.equal(r.detected, true); assert.deepEqual(r.techniques, ["ColorGrade"]); assert.deepEqual(r.includes, ["Common.fxh"]); assert.equal(r.missingIncludes.length, 0);
  assert.ok(r.detectedEffects.includes("bloom")); assert.ok(r.detectedEffects.includes("color-adjustment")); assert.equal(r.summary.pcBinaries, 1); assert.equal(r.ps4PackageReady, false);
});
test("flags missing includes and depth-dependent effects", () => {
  const r = inspectReshadeMod([file("Shaders/RTGI.fx", '#include "Missing.fxh"\n// RTGI depth buffer screen space reflections')]);
  assert.deepEqual(r.missingIncludes, ["Missing.fxh"]); assert.ok(r.requirements.some((x) => x.includes("renderer data/hooks"))); assert.ok(r.requirements.some((x) => x.includes("Resolve every shader include")));
});
test("does not treat preset-only INI as complete shader implementation", () => {
  const r = inspectReshadeMod([file("DYNA.ini", "[GENERAL]\nTechniqueSorting=Bloom,Vibrance\n")]);
  assert.equal(r.detected, true); assert.equal(r.summary.sourceFiles, 0); assert.ok(r.requirements.some((x) => x.includes("No ReShade .fx"))); assert.equal(r.ps4PackageReady, false);
});
test("ignores unrelated text and handles absent byte buffers", () => { const r = inspectReshadeMod([{ path: "notes.txt" }]); assert.equal(r.detected, false); assert.equal(r.summary.sourceFiles, 0); });
