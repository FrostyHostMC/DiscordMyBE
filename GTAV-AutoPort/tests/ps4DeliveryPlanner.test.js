import test from "node:test";
import assert from "node:assert/strict";
import { buildPs4DeliveryPlan } from "../src/core/ps4DeliveryPlanner.js";

test("routes Windows plugins away from PS4 native plugin output", () => {
  const plan = buildPs4DeliveryPlan({ files: [{ path: "plugins/ScriptHookV.dll", size: 123 }] });
  assert.equal(plan.items[0].route, "preserve-pc-runtime-only");
  assert.equal(plan.items[0].status, "blocked");
  assert.equal(plan.summary.installable, false);
});

test("does not assume PRX extension proves target compatibility", () => {
  const plan = buildPs4DeliveryPlan({ files: [{ path: "plugins/menu.prx" }] });
  assert.equal(plan.items[0].route, "validate-orbis-plugin");
  assert.equal(plan.items[0].status, "target-validation-required");
});

test("distinguishes extracted PC RPF from an unknown or Orbis archive", () => {
  const plan = buildPs4DeliveryPlan({
    files: [{ path: "cars/dlc.rpf" }, { path: "other/unknown.rpf" }],
    archiveInspections: [
      { sourcePath: "cars/dlc.rpf", status: "extracted-raw-open-archive" },
      { sourcePath: "other/unknown.rpf", status: "unsupported", error: "unsupported encryption marker" }
    ]
  });
  assert.equal(plan.items[0].route, "inspect-contents-then-package");
  assert.equal(plan.items[0].status, "source-inspected");
  assert.equal(plan.items[1].route, "preserve-and-identify-archive");
  assert.match(plan.items[1].reason, /unsupported encryption marker/);
});

test("never upgrades PC Legacy round-trip to PS4-ready", () => {
  const plan = buildPs4DeliveryPlan({
    files: [{ path: "stream/car.yft" }],
    conversions: [{ sourcePath: "stream/car.yft", status: "pc-legacy-candidate" }],
    target: { titleId: "CUSA00419", updateVersion: "1.73" }
  });
  assert.equal(plan.items[0].status, "pc-candidate-only");
  assert.equal(plan.summary.ps4ReadyFiles, 0);
  assert.equal(plan.summary.installable, false);
  assert.equal(plan.target.exactRequestedTarget, true);
  assert.equal(plan.target.compatibilityVerified, false);
});

test("keeps metadata translation separate from extension renaming", () => {
  const plan = buildPs4DeliveryPlan({ files: [{ path: "data/vehicles.meta" }, { path: "data/clip.ymt" }, { path: "stream/car.yft" }] });
  assert.equal(plan.items[0].route, "metadata-translation-review");
  assert.equal(plan.items[1].route, "pso-metadata-edit-review");
  assert.equal(plan.items[2].route, "resource-loader-compatibility");
  assert.ok(plan.limitations[0].includes("YMT to OMT"));
});

test("classifies source assets and preserves unknown files", () => {
  const plan = buildPs4DeliveryPlan({ files: [{ path: "textures/body.dds", size: 512 }, { path: "opaque/custom.bin" }] });
  assert.equal(plan.items[0].route, "source-asset-conversion");
  assert.equal(plan.items[1].route, "preserve-and-review");
  assert.equal(plan.summary.fileCount, 2);
});

test("returns an explicit non-integrated packaging boundary", () => {
  const plan = buildPs4DeliveryPlan({ files: [], target: { titleId: "CUSA00419", updateVersion: "1.73" } });
  assert.equal(plan.packaging.orbisRpfBackend, "not-integrated");
  assert.equal(plan.packaging.projectVLoader, "not-configured");
  assert.equal(plan.summary.installable, false);
});
