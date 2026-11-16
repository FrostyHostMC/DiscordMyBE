import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUpdateVersion, resolvePs4Target, PS4_TARGETS } from "../src/core/target.js";
test("US and EU title IDs resolve to separate 1.57 profiles", () => {
  const us = resolvePs4Target({ titleId: "CUSA00419", updateVersion: "1.57" });
  const eu = resolvePs4Target({ titleId: "cusa00411", updateVersion: "01.57" });
  assert.equal(us.status, "matched"); assert.equal(us.target.region, "US");
  assert.equal(eu.status, "matched"); assert.equal(eu.target.region, "EU");
  assert.notEqual(us.target.titleId, eu.target.titleId);
});
test("title ID alone selects a region but does not claim update verification", () => {
  const result = resolvePs4Target({ titleId: "CUSA00411" });
  assert.equal(result.status, "title-matched-version-unconfirmed");
  assert.equal(result.target.region, "EU");
});
test("unknown title IDs never fall back to the US profile", () => {
  const result = resolvePs4Target({ titleId: "CUSA99999", updateVersion: "1.57" });
  assert.equal(result.status, "unsupported-title"); assert.equal(result.target, null);
});
test("wrong update version is rejected for a known title ID", () => {
  const result = resolvePs4Target({ titleId: "CUSA00419", updateVersion: "1.46" });
  assert.equal(result.status, "unsupported-update"); assert.equal(result.target, PS4_TARGETS.CUSA00419);
});
test("version normalization accepts common SFO formatting without guessing unknown values", () => {
  assert.equal(normalizeUpdateVersion("01.57"), "1.57");
  assert.equal(normalizeUpdateVersion("1.57"), "1.57");
  assert.equal(normalizeUpdateVersion("1.46"), "1.46");
  assert.equal(normalizeUpdateVersion("unknown-build"), "unknown-build");
  assert.equal(normalizeUpdateVersion(null), null);
});
