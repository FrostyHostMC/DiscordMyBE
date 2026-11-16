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
    target: { titleId: "CUSA00419", updateVersion: "1.57" }
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
  const plan = buildPs4DeliveryPlan({ files: [], target: { titleId: "CUSA00419", updateVersion: "1.57" } });
  assert.equal(plan.packaging.orbisRpfBackend, "not-integrated");
  assert.equal(plan.packaging.projectVLoader, "not-configured");
  assert.equal(plan.summary.installable, false);
});


test("keeps ORBX .rpf.txt path markers out of archive conversion", () => {
  const plan = buildPs4DeliveryPlan({
    files: [
      { path: "orbx/gta/rpf/levels/gta5/update.rpf.txt", size: 0 },
      { path: "orbx/gta/ps4a.rpf", size: 1024 }
    ]
  });
  assert.equal(plan.items[0].route, "preserve-orbx-rpf-path-marker");
  assert.equal(plan.items[0].status, "marker-review-required");
  assert.equal(plan.items[1].route, "preserve-and-identify-archive");
});


function elfHeader({ machine = 62, is64 = true } = {}) {
  const bytes = new Uint8Array(128);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, is64 ? 2 : 1, 1, 1, 0]);
  const view = new DataView(bytes.buffer);
  view.setUint16(16, 3, true);
  view.setUint16(18, machine, true);
  view.setUint32(20, 1, true);
  view.setUint16(is64 ? 52 : 40, is64 ? 64 : 52, true);
  return bytes;
}

function peHeader() {
  const bytes = new Uint8Array(256);
  const view = new DataView(bytes.buffer);
  bytes.set([0x4d, 0x5a]);
  view.setUint32(0x3c, 0x80, true);
  view.setUint32(0x80, 0x00004550, true);
  view.setUint16(0x84, 0x8664, true);
  view.setUint16(0x86, 3, true);
  view.setUint16(0x94, 0xf0, true);
  view.setUint16(0x98, 0x20b, true);
  return bytes;
}

test("uses binary evidence to reject a Windows PE disguised as a PS4 PRX", () => {
  const plan = buildPs4DeliveryPlan({ files: [{ path: "plugins/fake.prx", bytes: peHeader() }] });
  assert.equal(plan.items[0].status, "blocked-binary-mismatch");
  assert.equal(plan.items[0].binaryInspection.format, "pe");
  assert.match(plan.items[0].reason, /Windows PE header/);
});

test("blocks a PRX candidate with a non-PS4 ELF architecture", () => {
  const plan = buildPs4DeliveryPlan({ files: [{ path: "plugins/wrong-arch.sprx", bytes: elfHeader({ machine: 40 }) }] });
  assert.equal(plan.items[0].status, "blocked-binary-mismatch");
  assert.equal(plan.items[0].binaryInspection.machineName, "ARM");
  assert.match(plan.items[0].reason, /does not match the PS4 x86-64/);
});

test("keeps x86-64 ELF plugin candidates unverified pending Orbis checks", () => {
  const plan = buildPs4DeliveryPlan({ files: [{ path: "plugins/candidate.prx", bytes: elfHeader() }] });
  assert.equal(plan.items[0].status, "target-validation-required");
  assert.equal(plan.items[0].binaryInspection.architectureCompatibleWithPs4Cpu, true);
  assert.match(plan.items[0].reason, /Orbis ABI/);
  assert.equal(plan.summary.installable, false);
});


test("treats a PlayStation SELF header as opaque target-validation evidence", () => {
  const plan = buildPs4DeliveryPlan({ files: [{ path: "plugins/candidate.sprx", bytes: new Uint8Array([0x4f, 0x15, 0x3d, 0x1d, 1, 2, 3, 4]) }] });
  assert.equal(plan.items[0].status, "target-validation-required");
  assert.equal(plan.items[0].binaryInspection.format, "self-container");
  assert.match(plan.items[0].reason, /Sony SCE executable container/);
});
