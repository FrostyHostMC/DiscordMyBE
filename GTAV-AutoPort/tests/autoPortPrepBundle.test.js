import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildAutomaticPrepBundle } from "../src/core/autoPortPrepBundle.js";

test("requires an imported mod", async () => {
  await assert.rejects(() => buildAutomaticPrepBundle({ files: [] }), /Import a PC mod/);
});

test("keeps the PS4 gate closed when there are no convertible resources", async () => {
  const result = await buildAutomaticPrepBundle({
    sourceName: "metadata-only",
    target: { titleId: "CUSA00419", updateVersion: "1.73" },
    reports: { "port-plan": { summary: { fileCount: 1 } } },
    files: [{ path: "vehicles.meta", bytes: new TextEncoder().encode("<CVehicleModelInfo__InitDataList/>") }]
  });
  assert.equal(result.manifest.summary.importedFiles, 1);
  assert.equal(result.manifest.summary.convertibleCandidates, 0);
  assert.equal(result.manifest.summary.ps4ReadyFiles, 0);
  assert.equal(result.manifest.summary.installable, false);
  assert.ok(result.blob.size > 0);
  const archive = await JSZip.loadAsync(result.blob);
  assert.ok(archive.file("AutoPort-Prep/source-original/vehicles.meta"));
  assert.ok(archive.file("AutoPort-Prep/autoport-manifest.json"));
  assert.ok(archive.file("AutoPort-Prep/reports/port-plan.json"));
  const report = JSON.parse(await archive.file("AutoPort-Prep/reports/port-plan.json").async("string"));
  assert.equal(report.summary.fileCount, 1);
});

test("rejects unsafe imported paths instead of normalizing traversal away", async () => {
  await assert.rejects(() => buildAutomaticPrepBundle({
    files: [{ path: "../outside.bin", bytes: new Uint8Array([1, 2, 3]) }]
  }), /unsafe relative path/);
});
