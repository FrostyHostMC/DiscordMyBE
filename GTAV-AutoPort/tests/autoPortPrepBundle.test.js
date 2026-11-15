import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildAutomaticPrepBundle } from "../src/core/autoPortPrepBundle.js";
import { buildOpenRpf7 } from "../src/core/rpf7OpenBuilder.js";

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
  assert.ok(archive.file("AutoPort-Prep/reports/dependency-graph.json"));
  assert.equal(result.manifest.dependencies.references, 0);
  const dependencyReport = JSON.parse(await archive.file("AutoPort-Prep/reports/dependency-graph.json").async("string"));
  assert.equal(dependencyReport.status, "read-only-reference-analysis");
  const report = JSON.parse(await archive.file("AutoPort-Prep/reports/port-plan.json").async("string"));
  assert.equal(report.summary.fileCount, 1);
});

test("rejects unsafe imported paths instead of normalizing traversal away", async () => {
  await assert.rejects(() => buildAutomaticPrepBundle({
    files: [{ path: "../outside.bin", bytes: new Uint8Array([1, 2, 3]) }]
  }), /unsafe relative path/);
});

test("automatically extracts supported OPEN RPF payloads while preserving the original archive", async () => {
  const payload = new TextEncoder().encode("<HandlingData/>");
  const archiveBytes = buildOpenRpf7([{ path: "common/data/handling.meta", bytes: payload }]).bytes;
  const result = await buildAutomaticPrepBundle({ files: [{ path: "cars/sample/dlc.rpf", bytes: archiveBytes }] });
  assert.equal(result.manifest.summary.rpfArchivesInspected, 1);
  assert.equal(result.manifest.summary.rpfArchivesExtracted, 1);
  assert.equal(result.manifest.summary.rpfRawFilesExtracted, 1);
  assert.equal(result.manifest.summary.ps4ReadyFiles, 0);
  const archive = await JSZip.loadAsync(result.blob);
  assert.ok(archive.file("AutoPort-Prep/source-original/cars/sample/dlc.rpf"));
  assert.deepEqual(new Uint8Array(await archive.file("AutoPort-Prep/rpf-extracted/cars/sample/dlc.rpf/common/data/handling.meta").async("uint8array")), payload);
  assert.equal(result.manifest.archiveInspections[0].status, "extracted-raw-open-archive");
});

test("keeps unsupported Orbis RPF bytes intact and reports the unsupported marker", async () => {
  const open = buildOpenRpf7([{ path: "a.bin", bytes: new Uint8Array([1]) }]).bytes;
  const orbisLike = open.slice();
  new DataView(orbisLike.buffer).setUint32(12, 0x0ffeffff, true);
  const result = await buildAutomaticPrepBundle({ files: [{ path: "dlc.rpf", bytes: orbisLike }] });
  assert.equal(result.manifest.summary.rpfArchivesExtracted, 0);
  assert.match(result.manifest.archiveInspections[0].error, /not the supported OPEN variant/);
  const archive = await JSZip.loadAsync(result.blob);
  assert.ok(archive.file("AutoPort-Prep/source-original/dlc.rpf"));
  assert.equal(archive.file("AutoPort-Prep/rpf-extracted/dlc.rpf"), null);
});

test("includes extracted RPF metadata in automatic dependency analysis", async () => {
  const handling = new TextEncoder().encode("<HandlingData>vehicles.meta</HandlingData>");
  const vehicles = new TextEncoder().encode("<CVehicleModelInfo__InitDataList/>");
  const archiveBytes = buildOpenRpf7([
    { path: "common/data/handling.meta", bytes: handling },
    { path: "common/data/vehicles.meta", bytes: vehicles }
  ]).bytes;
  const result = await buildAutomaticPrepBundle({ files: [{ path: "cars/sample/dlc.rpf", bytes: archiveBytes }] });
  assert.equal(result.manifest.summary.rpfRawFilesAnalyzed, 2);
  assert.equal(result.manifest.dependencies.references, 1);
  assert.equal(result.manifest.dependencies.resolved, 1);
  assert.equal(result.manifest.dependencies.missing, 0);
  assert.equal(result.manifest.dependencies.ambiguous, 0);
  assert.equal(result.manifest.archiveInspections[0].status, "extracted-raw-open-archive");
});

test("records extracted archive entry provenance and detected format in the manifest", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const archiveBytes = buildOpenRpf7([{ path: "stream/preview.png", bytes: png }]).bytes;
  const result = await buildAutomaticPrepBundle({
    files: [{ path: "cars/sample/dlc.rpf", bytes: archiveBytes }]
  });
  const archiveRecord = result.manifest.archiveInspections[0];
  assert.equal(archiveRecord.sourcePath, "cars/sample/dlc.rpf");
  assert.equal(archiveRecord.entries.length, 1);
  assert.deepEqual(archiveRecord.entries[0], {
    path: "stream/preview.png",
    archivePath: "cars/sample/dlc.rpf/stream/preview.png",
    analysisPath: "rpf-extracted/cars/sample/dlc.rpf/stream/preview.png",
    size: png.length,
    extracted: true,
    formatStatus: "recognized",
    adapterId: "png",
    role: "image",
    evidence: ["PNG signature"],
    candidates: [{ adapterId: "png", confidence: 1, role: "image" }]
  });
  const archive = await JSZip.loadAsync(result.blob);
  assert.ok(archive.file("AutoPort-Prep/rpf-extracted/cars/sample/dlc.rpf/stream/preview.png"));
});

test("keeps extracted analysis paths separate from standalone upload paths", async () => {
  const nestedPath = "cars/sample/dlc.rpf/common/data/vehicles.meta";
  const standalone = new TextEncoder().encode("<Standalone/>");
  const insideArchive = new TextEncoder().encode("<Inside/>");
  const archiveBytes = buildOpenRpf7([{ path: "common/data/vehicles.meta", bytes: insideArchive }]).bytes;
  const result = await buildAutomaticPrepBundle({
    files: [
      { path: nestedPath, bytes: standalone },
      { path: "cars/sample/dlc.rpf", bytes: archiveBytes }
    ]
  });
  const archive = await JSZip.loadAsync(result.blob);
  assert.deepEqual(new Uint8Array(await archive.file("AutoPort-Prep/source-original/" + nestedPath).async("uint8array")), standalone);
  assert.deepEqual(new Uint8Array(await archive.file("AutoPort-Prep/rpf-extracted/cars/sample/dlc.rpf/common/data/vehicles.meta").async("uint8array")), insideArchive);
  assert.equal(result.manifest.archiveInspections[0].entries[0].analysisPath, "rpf-extracted/cars/sample/dlc.rpf/common/data/vehicles.meta");
});

test("retains the full validated file inventory when extraction exceeds its file limit", async () => {
  const files = Array.from({ length: 5001 }, (_, index) => ({
    path: "payload/" + String(index).padStart(4, "0") + ".bin",
    bytes: new Uint8Array([index & 0xff])
  }));
  const archiveBytes = buildOpenRpf7(files).bytes;
  const result = await buildAutomaticPrepBundle({
    files: [{ path: "large/dlc.rpf", bytes: archiveBytes }]
  });
  const record = result.manifest.archiveInspections[0];
  assert.equal(record.status, "validated-not-extracted");
  assert.match(record.error, /file-count limit/);
  assert.equal(record.entries.length, 5001);
  assert.equal(record.entries.filter((entry) => entry.extracted).length, 0);
  assert.ok(record.entries.some((entry) => entry.path === "payload/5000.bin" && entry.size === 1));
  assert.equal(result.manifest.summary.rpfRawFilesExtracted, 0);
});
test("recursively extracts nested PC RPF archives and preserves both containers", async () => {
  const payload = new TextEncoder().encode("<HandlingData/>");
  const nestedBytes = buildOpenRpf7([{ path: "common/data/handling.meta", bytes: payload }]).bytes;
  const outerBytes = buildOpenRpf7([{ path: "nested/dlc.rpf", bytes: nestedBytes }]).bytes;
  const result = await buildAutomaticPrepBundle({ files: [{ path: "cars/outer.rpf", bytes: outerBytes }] });
  assert.equal(result.manifest.summary.rpfArchivesInspected, 2);
  assert.equal(result.manifest.summary.rpfArchivesExtracted, 2);
  assert.equal(result.manifest.summary.rpfRawFilesExtracted, 2);
  assert.equal(result.manifest.summary.rpfRawFilesAnalyzed, 2);
  assert.equal(result.manifest.archiveInspections[1].sourcePath, "rpf-extracted/cars/outer.rpf/nested/dlc.rpf");
  assert.equal(result.manifest.archiveInspections[1].parentArchive, "cars/outer.rpf");
  assert.equal(result.manifest.deliveryPlan.items.find((item) => item.path === "rpf-extracted/cars/outer.rpf/nested/dlc.rpf").route, "inspect-contents-then-package");
  const archive = await JSZip.loadAsync(result.blob);
  assert.ok(archive.file("AutoPort-Prep/source-original/cars/outer.rpf"));
  assert.ok(archive.file("AutoPort-Prep/rpf-extracted/cars/outer.rpf/nested/dlc.rpf"));
  assert.deepEqual(
    new Uint8Array(await archive.file("AutoPort-Prep/rpf-extracted/cars/outer.rpf/nested/dlc.rpf/common/data/handling.meta").async("uint8array")),
    payload
  );
});
