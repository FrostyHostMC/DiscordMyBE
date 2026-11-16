import test from "node:test";
import assert from "node:assert/strict";
import { PS4_TARGET, PS4_TARGETS, SUPPORTED_TITLE_IDS, describeTarget, resolveTargetByTitleId } from "../src/core/target.js";

test("default PS4 target is the user-confirmed US CUSA00419 1.57 profile", () => {
  assert.equal(PS4_TARGET.titleId, "CUSA00419");
  assert.equal(PS4_TARGET.updateVersion, "1.57");
  assert.equal(PS4_TARGET.region, "US");
  assert.equal(PS4_TARGET.publisherId, "UP1004");
  assert.equal(PS4_TARGET.contentId, "UP1004-CUSA00419_00-GTAVDIGITALDOWNL");
  assert.equal(PS4_TARGET.platform, "PlayStation 4");
  assert.equal(PS4_TARGET.mode, "Story Mode");
});

test("US and EU profiles are separately represented for GTA V 1.57", () => {
  assert.deepEqual(SUPPORTED_TITLE_IDS, ["CUSA00419", "CUSA00411"]);
  assert.equal(PS4_TARGETS.CUSA00419.region, "US");
  assert.equal(PS4_TARGETS.CUSA00411.region, "EU");
  assert.equal(PS4_TARGETS.CUSA00419.updateVersion, "1.57");
  assert.equal(PS4_TARGETS.CUSA00411.updateVersion, "1.57");
  assert.equal(PS4_TARGETS.CUSA00411.contentId, null);
  assert.equal(PS4_TARGETS.CUSA00411.publisherId, null);
  assert.equal(PS4_TARGETS.CUSA00411.resourceCompatibility, "unverified");
});

test("title-ID resolver recognizes supported regions and rejects unknown values", () => {
  assert.equal(resolveTargetByTitleId("cusa00419"), PS4_TARGETS.CUSA00419);
  assert.equal(resolveTargetByTitleId(" CUSA00411 "), PS4_TARGETS.CUSA00411);
  assert.equal(resolveTargetByTitleId("CUSA99999"), null);
  assert.equal(resolveTargetByTitleId(null), null);
});

test("user-confirmed console firmware and GoldHEN version remain on the US profile", () => {
  assert.equal(PS4_TARGET.systemFirmware, "14.00");
  assert.equal(PS4_TARGET.systemFirmwareSource, "user-confirmed");
  assert.equal(PS4_TARGET.goldhenVersion, "2.4b18.13");
  assert.equal(PS4_TARGET.goldhenVersionSource, "user-confirmed");
  assert.equal(PS4_TARGETS.CUSA00411.goldhenVersion, undefined);
});

test("target profiles remain explicitly unverified for resource compatibility", () => {
  for (const target of Object.values(PS4_TARGETS)) {
    assert.equal(target.verifiedAgainstConsole, false);
    assert.equal(target.resourceCompatibility, "unverified");
  }
});

test("target label is stable for UI and manifests", () => {
  assert.equal(describeTarget(), "CUSA00419 · GTA V 1.57 · Story Mode");
});
