import test from "node:test";
import assert from "node:assert/strict";
import { createOrbisRpfBuildPlan } from "../src/core/orbisRpfBuilder.js";

test("creates an Orbis build script for root and nested files", () => {
  const plan = createOrbisRpfBuildPlan([{ path: "content.xml", size: 100 }, { path: "common/data/handling.meta", size: 2048 }], "vehicle_pack.rpf");
  assert.equal(plan.platform, "orbis");
  assert.match(plan.lua, /set_platform\("orbis"\)/);
  assert.match(plan.lua, /add_file_to_archive\(archive_file, "", "content\.xml"\)/);
  assert.match(plan.lua, /"common\/data", "handling\.meta"/);
  assert.match(plan.batch, /ragebuilder_x64_0378\.exe/);
  assert.equal(plan.compatibility.verifiedOnConsole, false);
  assert.equal(plan.compatibility.installable, false);
});
test("normalizes Windows separators", () => {
  const plan = createOrbisRpfBuildPlan([{ path: "common\\data\\handling.meta" }]);
  assert.match(plan.lua, /"common\/data", "handling\.meta"/);
});
test("rejects traversal, absolute paths, and drive paths", () => {
  for (const path of ["../outside.txt", "common/../../outside", "/absolute/file", "C:\\temp\\file"]) assert.throws(() => createOrbisRpfBuildPlan([{ path }]), /relative|unsafe/);
});
test("rejects duplicate archive destinations case-insensitively", () => {
  assert.throws(() => createOrbisRpfBuildPlan([{ path: "common/data/handling.meta" }, { path: "COMMON/DATA/Handling.meta" }]), /Duplicate archive path/);
});
test("requires files and a simple RPF output filename", () => {
  assert.throws(() => createOrbisRpfBuildPlan([]), /at least one file/);
  assert.throws(() => createOrbisRpfBuildPlan([{ path: "content.xml" }], "../bad.rpf"), /simple .rpf filename/);
});
