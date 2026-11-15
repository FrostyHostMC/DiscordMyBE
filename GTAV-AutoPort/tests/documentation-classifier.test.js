import test from "node:test";
import assert from "node:assert/strict";
import { auditModFiles } from "../src/core/modClassifier.js";
import { buildUniversalPortPlan } from "../src/core/portPlan.js";

test("classifies readme and installation instructions as documentation", () => {
  const result = auditModFiles([
    { path: "readmeEN.txt", bytes: new Uint8Array([65]), size: 1 },
    { path: "安装说明CH.txt", bytes: new Uint8Array([66]), size: 1 },
  ]);
  assert.equal(result.summary.unknownFiles, 0);
  assert.equal(result.summary.familyCounts.documentation, 2);
});

test("routes documentation to a reviewable instruction stage", () => {
  const plan = buildUniversalPortPlan({ files: [
    { path: "readmeEN.txt", size: 1 },
    { path: "安装说明CH.txt", size: 1 },
  ] });
  assert.equal(plan.summary.fileCount, 2);
  assert.ok(plan.pipeline.some((stage) => stage.stage === "documentation-review"));
  assert.ok(plan.resources.every((resource) => resource.family === "documentation"));
});
