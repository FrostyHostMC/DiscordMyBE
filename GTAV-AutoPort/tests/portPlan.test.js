import test from "node:test";
import assert from "node:assert/strict";
import { buildUniversalPortPlan } from "../src/core/portPlan.js";

const file = (path, size = 10) => ({ path, size, extension: path.slice(path.lastIndexOf(".")).toLowerCase() });

test("builds a universal plan for multiple asset families", () => {
  const plan = buildUniversalPortPlan({ files: [
    file("vehicles/crown.yft"), file("vehicles/crown_hi.yft"), file("vehicles/crown.ytd"),
    file("maps/downtown.ymap"), file("maps/downtown.ytyp"),
    file("scripts/trainer.asi"), file("readme.txt"),
  ] });
  assert.equal(plan.mode, "plan-only");
  assert.equal(plan.summary.fileCount, 7);
  assert.equal(plan.resources.find((item) => item.path.endsWith(".yft")).family, "fragment");
  assert.equal(plan.resources.find((item) => item.path.endsWith(".ymap")).family, "map-placement");
  assert.equal(plan.resources.find((item) => item.path.endsWith(".asi")).status, "behavior-reimplementation");
  assert.equal(plan.resources.find((item) => item.path.endsWith(".txt")).status, "manual-format-identification");
  assert.equal(plan.summary.installable, false);
});

test("marks same-basename asset groupings as unverified candidate relationships", () => {
  const plan = buildUniversalPortPlan({ files: [file("a/car.yft"), file("a/car.ytd"), file("a/car_hi.yft")] });
  assert.ok(plan.candidateRelationships.length > 0);
  assert.ok(plan.candidateRelationships.every((pair) => pair.verifiedDependency === false));
  assert.ok(plan.candidateRelationships.every((pair) => pair.confidence === "filename-co-location-only"));
});

test("keeps PS4 target explicit and does not claim conversion output", () => {
  const plan = buildUniversalPortPlan({ files: [file("model.yft")] });
  assert.equal(plan.target.titleId, "CUSA00411");
  assert.equal(plan.target.updateVersion, "1.73");
  assert.equal(plan.summary.conversionOutputsWritten, 0);
  assert.equal(plan.resources[0].status, "blocked-pending-target-adapter");
});

test("empty imports produce an empty but safe plan", () => {
  const plan = buildUniversalPortPlan();
  assert.equal(plan.summary.fileCount, 0);
  assert.equal(plan.summary.blockedCount, 0);
  assert.equal(plan.summary.installable, false);
});
