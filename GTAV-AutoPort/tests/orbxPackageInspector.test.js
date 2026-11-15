import test from "node:test";
import assert from "node:assert/strict";
import { inspectOrbxPackage } from "../src/core/orbxPackageInspector.js";

test("recognizes the ORBX plugin and INI even when nested in vendor folders", () => {
  const report = inspectOrbxPackage([
    { path: "Orbx Engine v1.4/Orbx Engine v1.4/orbx.prx", size: 1024 },
    { path: "Orbx Engine v1.4/Orbx Engine v1.4/orbx/orbx.ini", size: 457 },
    { path: "Orbx Engine v1.4/ps4a.rpf", size: 2048 },
    { path: "Orbx Engine v1.4/Orbx Engine v1.4/orbx/gta/rpf/patch.rpf", size: 4096 }
  ]);
  assert.equal(report.detected, true);
  assert.equal(report.status, "package-components-detected");
  assert.equal(report.components.plugin.files[0].path, "Orbx Engine v1.4/Orbx Engine v1.4/orbx.prx");
  assert.equal(report.components.configuration.expectedRuntimePath, "/data/orbx/orbx.ini");
  assert.equal(report.components.configuration.contentsInspected, false);
  assert.equal(report.components.resourceArchives.length, 2);
  assert.equal(report.components.gtaResourceTreeFileCount, 1);
  assert.equal(report.installReview.deploymentAuthorized, false);
  assert.equal(report.installReview.runtimeCompatibilityVerified, false);
});

test("reports a missing INI without inventing a replacement", () => {
  const report = inspectOrbxPackage([{ path: "plugins/orbx.prx", size: 100 }]);
  assert.equal(report.detected, false);
  assert.equal(report.status, "incomplete-package");
  assert.ok(report.warnings.some((message) => message.includes("orbx.ini was not found")));
  assert.ok(report.warnings.some((message) => message.includes("empty replacement")));
  assert.equal(report.components.configuration.expectedRuntimePath, null);
});

test("does not infer support from a PRX extension or archive presence", () => {
  const report = inspectOrbxPackage([
    { path: "orbx.prx", size: 10 },
    { path: "orbx.ini", size: 20 },
    { path: "ps4a.rpf", size: 30 }
  ]);
  assert.equal(report.detected, true);
  assert.equal(report.installReview.runtimeCompatibilityVerified, false);
  assert.equal(report.installReview.deploymentAuthorized, false);
  assert.ok(report.limitations.some((message) => message.includes("PRX filename does not prove")));
});

test("flags duplicate plugin/config copies and missing resource tree", () => {
  const report = inspectOrbxPackage([
    { path: "one/orbx.prx" },
    { path: "two/orbx.prx" },
    { path: "one/orbx.ini" },
    { path: "two/orbx.ini" }
  ]);
  assert.equal(report.detected, true);
  assert.ok(report.warnings.some((message) => message.includes("Multiple orbx.prx")));
  assert.ok(report.warnings.some((message) => message.includes("Multiple orbx.ini")));
  assert.ok(report.warnings.some((message) => message.includes("No files under an orbx/gta")));
});
