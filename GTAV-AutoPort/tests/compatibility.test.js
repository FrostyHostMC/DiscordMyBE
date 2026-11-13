import test from "node:test";
import assert from "node:assert/strict";
import { assessPs4Compatibility } from "../src/core/compatibility.js";
import { PS4_TARGET } from "../src/core/target.js";

test("default target assessment blocks conversion and deployment", () => {
  const result = assessPs4Compatibility();
  assert.equal(result.status, "blocked");
  assert.equal(result.target.titleId, "CUSA00411");
  assert.equal(result.target.updateVersion, "1.73");
  assert.equal(result.conversionAllowed, false);
  assert.equal(result.deploymentAllowed, false);
  assert.equal(result.passed, 0);
  assert.equal(result.total, 7);
});

test("PC-side evidence alone cannot satisfy PS4 compatibility gates", () => {
  const result = assessPs4Compatibility({
    consoleVerified: true,
    goldhenVersion: "example-version",
    ps4ReferenceResources: { yft: false, ytd: false },
    adapters: { yft: false, ytd: false },
    deploymentValidated: false,
  });
  assert.equal(result.passed, 2);
  assert.equal(result.status, "blocked");
  assert.equal(result.conversionAllowed, false);
  assert.equal(result.deploymentAllowed, false);
});

test("all gates are individually evidence-driven", () => {
  const result = assessPs4Compatibility({
    target: PS4_TARGET,
    consoleVerified: true,
    goldhenVersion: "recorded",
    ps4ReferenceResources: { yft: true, ytd: true },
    adapters: { yft: true, ytd: true },
    deploymentValidated: true,
  });
  assert.equal(result.status, "validated");
  assert.equal(result.passed, 7);
  // A green checklist is not an authorization to enable code that does not exist.
  assert.equal(result.conversionAllowed, false);
  assert.equal(result.deploymentAllowed, false);
});

test("blank GoldHEN values do not count as recorded evidence", () => {
  const result = assessPs4Compatibility({ goldhenVersion: "   " });
  assert.equal(result.gates.find((gate) => gate.id === "goldhen").passed, false);
});
