import test from "node:test";
import assert from "node:assert/strict";
import { buildPs4AfrPackage } from "../src/core/ps4Package.js";

const target = { titleId: "CUSA00411", game: "Grand Theft Auto V", updateVersion: "1.57", mode: "Story Mode" };
const rpf = { path: "update.rpf", bytes: new Uint8Array([82,80,70,55,1,2,3,4]) };

test("refuses packaging without PS4 resource and exact path attestations", async () => {
  await assert.rejects(() => buildPs4AfrPackage({ files: [rpf], mappings: { "update.rpf": "/app0/update/update.rpf" }, target }), /Confirm that each selected RPF/);
  await assert.rejects(() => buildPs4AfrPackage({ files: [rpf], mappings: { "update.rpf": "/app0/update/update.rpf" }, target, attestations: { ps4ResourceBuildVerified: true } }), /Confirm that every/);
});

test("rejects PC/non-RPF inputs and unsafe or duplicate destinations", async () => {
  const attestations = { ps4ResourceBuildVerified: true, destinationPathsVerified: true };
  await assert.rejects(() => buildPs4AfrPackage({ files: [{ path: "car.yft", bytes: rpf.bytes }], target, attestations }), /Only complete/);
  await assert.rejects(() => buildPs4AfrPackage({ files: [rpf], mappings: { "update.rpf": "/app0/../evil.rpf" }, target, attestations }), /safe/);
  await assert.rejects(() => buildPs4AfrPackage({ files: [rpf, { ...rpf, path: "other.rpf" }], mappings: { "update.rpf": "/app0/update/update.rpf", "other.rpf": "/app0/update/update.rpf" }, target, attestations }), /same destination/);
  await assert.rejects(() => buildPs4AfrPackage({ files: [{ path: "update.rpf", bytes: new Uint8Array([0,1,2,3]) }], mappings: { "update.rpf": "/app0/update/update.rpf" }, target, attestations }), /RPF7 header/);
});

test("creates a target-specific AFR handoff while preserving source archive bytes", async () => {
  const result = await buildPs4AfrPackage({
    files: [rpf], mappings: { "update.rpf": "/app0/update/update.rpf" }, target,
    attestations: { ps4ResourceBuildVerified: true, destinationPathsVerified: true }
  });
  assert.equal(result.manifest.target.titleId, "CUSA00411");
  assert.equal(result.manifest.target.updateVersion, "1.57");
  assert.equal(result.manifest.conversionPerformed, false);
  assert.equal(result.manifest.entries[0].status, "staged-unchanged-ps4-rpf");
  assert.equal(result.manifest.entries[0].sha256.length, 64);
  assert.ok(result.blob.size > 0);
});
