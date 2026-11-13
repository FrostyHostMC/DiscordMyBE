import test from "node:test";
import assert from "node:assert/strict";
import { PS4_TARGET, describeTarget } from "../src/core/target.js";

test("first PS4 target is the user-confirmed CUSA00411 1.73 profile", () => {
  assert.equal(PS4_TARGET.titleId, "CUSA00411");
  assert.equal(PS4_TARGET.updateVersion, "1.73");
  assert.equal(PS4_TARGET.platform, "PlayStation 4");
  assert.equal(PS4_TARGET.mode, "Story Mode");
});

test("user-confirmed console firmware and GoldHEN version are recorded separately", () => {
  assert.equal(PS4_TARGET.systemFirmware, "14.00");
  assert.equal(PS4_TARGET.systemFirmwareSource, "user-confirmed");
  assert.equal(PS4_TARGET.goldhenVersion, "2.4b18.13");
  assert.equal(PS4_TARGET.goldhenVersionSource, "user-confirmed");
});

test("target profile remains explicitly unverified for resource compatibility", () => {
  assert.equal(PS4_TARGET.source, "user-confirmed");
  assert.equal(PS4_TARGET.verifiedAgainstConsole, false);
  assert.equal(PS4_TARGET.resourceCompatibility, "unverified");
});

test("target label is stable for UI and manifests", () => {
  assert.equal(describeTarget(), "CUSA00411 · GTA V 1.73 · Story Mode");
});
