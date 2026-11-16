import test from "node:test";
import assert from "node:assert/strict";
import { assessPs4Compatibility } from "../src/core/compatibility.js";
import { PS4_TARGET, PS4_TARGETS } from "../src/core/target.js";

test("default target is US GTA V 1.57 and remains fail-closed", () => {
  const result = assessPs4Compatibility();
  assert.equal(PS4_TARGET.titleId, "CUSA00419");
  assert.equal(PS4_TARGET.updateVersion, "1.57");
  assert.equal(result.status, "blocked");
  assert.equal(result.passed, 0);
  assert.equal(result.total, 7);
  assert.equal(result.conversionAllowed, false);
  assert.equal(result.deploymentAllowed, false);
});
test("both regional profiles target GTA V 1.57", () => {
  assert.deepEqual(Object.keys(PS4_TARGETS).sort(), ["CUSA00411", "CUSA00419"]);
  assert.equal(PS4_TARGETS.CUSA00411.region, "EU");
  assert.equal(PS4_TARGETS.CUSA00419.region, "US");
  for (const profile of Object.values(PS4_TARGETS)) {
    assert.equal(profile.updateVersion, "1.57");
    assert.equal(profile.resourceCompatibility, "unverified");
  }
});
test("user-entered profile and GoldHEN strings do not count as console evidence", () => {
  const result = assessPs4Compatibility({ target: PS4_TARGET, goldhenVersion: PS4_TARGET.goldhenVersion });
  assert.equal(result.passed, 0);
  assert.equal(result.status, "blocked");
});
test("every evidence gate can be satisfied but never unlocks nonexistent writers", () => {
  const result = assessPs4Compatibility({
    target: PS4_TARGETS.CUSA00411, consoleVerified: true, goldhenRuntimeVerified: true, goldhenVersion: "2.4b18",
    ps4ReferenceResources: { yft: true, ytd: true }, adapters: { yft: true, ytd: true }, deploymentValidated: true,
  });
  assert.equal(result.status, "evidence-complete");
  assert.equal(result.passed, 7);
  assert.equal(result.target.region, "EU");
  assert.equal(result.conversionAllowed, false);
  assert.equal(result.deploymentAllowed, false);
});
test("blank GoldHEN values do not count as runtime evidence", () => {
  const result = assessPs4Compatibility({ goldhenRuntimeVerified: true, goldhenVersion: "   " });
  assert.equal(result.gates.find((gate) => gate.id === "goldhen").passed, false);
});
