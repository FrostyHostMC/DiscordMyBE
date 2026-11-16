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
    target: { titleId: "CUSA00419", updateVersion: "1.57" },
    reports: { "port-plan": { summary: { fileCount: 1 } } },
    files: [{ path: "vehicles.meta", bytes: new TextEncoder().encode("<CVehicleModelInfo__InitDataList/>") }]
  });
  assert.equal(result.manifest.summary.importedFiles, 1);
  assert.match(result.manifest.sourceFiles[0].sha256, /^[a-f0-9]{64}$/);
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
  const { sha256: entrySha256, ...entryWithoutHash } = archiveRecord.entries[0];
  assert.match(entrySha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(entryWithoutHash, {
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
test("stops recursive RPF extraction at the configured nesting depth", async () => {
  let nested = buildOpenRpf7([{ path: "payload.bin", bytes: new Uint8Array([7]) }]).bytes;
  for (let depth = 4; depth >= 0; depth -= 1) {
    nested = buildOpenRpf7([{ path: "nested-" + depth + ".rpf", bytes: nested }]).bytes;
  }
  const result = await buildAutomaticPrepBundle({ files: [{ path: "deep/root.rpf", bytes: nested }] });
  assert.equal(result.manifest.archiveInspections.length, 6);
  assert.equal(result.manifest.archiveInspections[5].depth, 5);
  assert.equal(result.manifest.archiveInspections[5].status, "validated-not-extracted");
  assert.match(result.manifest.archiveInspections[5].error, /nesting.*depth limit/);
  assert.equal(result.manifest.summary.ps4ReadyFiles, 0);
});


test("exports bounded ORBX runtime-log diagnostics in the automatic prep report", async () => {
  const result = await buildAutomaticPrepBundle({
    sourceName: "orbx-diagnostic-fixture",
    target: { titleId: "CUSA00419", updateVersion: "1.57" },
    files: [
      { path: "orbx.prx", bytes: new Uint8Array([1, 2, 3]) },
      { path: "orbx.ini", bytes: new TextEncoder().encode("[Files]\nLoadMETA=true\n") },
      { path: "orbx/rpf_log.txt", bytes: new TextEncoder().encode("ORBX initialized\nERROR: unsupported game version\n") }
    ]
  });
  assert.equal(result.manifest.target.updateVersion, "1.57");
  assert.equal(result.manifest.orbxPackageAudit.components.runtimeLog.analysis.status, "parsed-with-signals");
  const archive = await JSZip.loadAsync(result.blob);
  const audit = JSON.parse(await archive.file("AutoPort-Prep/reports/orbx-package-audit.json").async("string"));
  assert.equal(audit.components.runtimeLog.analysis.signals[0].line, 2);
  assert.equal(audit.components.runtimeLog.analysis.signals[0].category, "error");
  assert.equal(audit.installReview.runtimeCompatibilityVerified, false);
});


function makeDdsFixture({ width = 16, height = 16, fourCC = "DXT1", mipCount = 1 } = {}) {
  const blockBytes = fourCC === "DXT1" ? 8 : 16;
  const payloadBytes = Array.from({ length: mipCount }, (_, level) =>
    Math.ceil(Math.max(1, width >> level) / 4) * Math.ceil(Math.max(1, height >> level) / 4) * blockBytes
  ).reduce((sum, size) => sum + size, 0);
  const bytes = new Uint8Array(128 + payloadBytes);
  bytes.set([0x44, 0x44, 0x53, 0x20]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 124, true);
  view.setUint32(8, 0x81007, true);
  view.setUint32(12, height, true);
  view.setUint32(16, width, true);
  view.setUint32(28, mipCount, true);
  view.setUint32(76, 32, true);
  view.setUint32(80, 4, true);
  for (let index = 0; index < 4; index++) bytes[84 + index] = fourCC.charCodeAt(index);
  view.setUint32(112, 0x1000, true);
  for (let index = 128; index < bytes.length; index++) bytes[index] = (index * 29 + 7) & 0xff;
  return bytes;
}

test("automatically creates experimental PS4 texture storage candidates from supported DDS files", async () => {
  const dds = makeDdsFixture({ width: 32, height: 16, fourCC: "DXT5", mipCount: 4 });
  const result = await buildAutomaticPrepBundle({
    target: { titleId: "CUSA00419", updateVersion: "1.57" },
    files: [{ path: "textures/vehicle_diffuse.dds", bytes: dds }]
  });
  assert.equal(result.manifest.summary.ps4TextureStorageCandidates, 1);
  assert.equal(result.manifest.summary.ps4ReadyFiles, 0);
  assert.equal(result.manifest.summary.installable, false);
  const texturePlan = result.manifest.deliveryPlan.items.find((item) => item.path === "textures/vehicle_diffuse.dds");
  assert.equal(texturePlan.route, "ps4-texture-storage-candidate-only");
  assert.equal(texturePlan.status, "partial-conversion");
  assert.equal(texturePlan.textureConversion.roundTripVerified, true);
  assert.equal(texturePlan.textureConversion.mipCount, 4);
  assert.equal(texturePlan.textureConversion.maxMipCount, 6);
  assert.equal(texturePlan.textureConversion.missingMipLevels, 2);
  assert.match(texturePlan.textureConversion.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(texturePlan.textureConversion.outputSha256, /^[a-f0-9]{64}$/);
  const archive = await JSZip.loadAsync(result.blob);
  const outputPath = "AutoPort-Prep/ps4-texture-storage-candidates/textures/vehicle_diffuse.dds.ps4tex.bin";
  const output = new Uint8Array(await archive.file(outputPath).async("uint8array"));
  const sidecar = JSON.parse(await archive.file(outputPath + ".json").async("string"));
  const report = JSON.parse(await archive.file("AutoPort-Prep/reports/ps4-texture-storage.json").async("string"));
  assert.equal(output.length, sidecar.storageBytes);
  assert.equal(sidecar.format, "BC3");
  assert.equal(sidecar.adapterId, "ps4-thin1dthin-dds-storage");
  assert.equal(sidecar.adapterVersion, "experimental-v1");
  assert.deepEqual(sidecar.target, { titleId: "CUSA00419", updateVersion: "1.57" });
  assert.equal(sidecar.tileIndex, 13);
  assert.equal(sidecar.installable, false);
  assert.match(sidecar.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(sidecar.outputSha256, /^[a-f0-9]{64}$/);
  assert.equal(report[0].sourceSha256, sidecar.sourceSha256);
  assert.equal(report[0].outputSha256, sidecar.outputSha256);
  assert.equal(report[0].status, "ps4-texture-storage-candidate");
  assert.ok(archive.file("AutoPort-Prep/source-original/textures/vehicle_diffuse.dds"));
});

test("records unsupported DDS formats without generating a misleading PS4 texture output", async () => {
  const result = await buildAutomaticPrepBundle({
    files: [{ path: "textures/unsupported.dds", bytes: makeDdsFixture({ fourCC: "DXT3" }) }]
  });
  assert.equal(result.manifest.summary.ps4TextureStorageCandidates, 0);
  assert.equal(result.manifest.summary.ps4ReadyFiles, 0);
  assert.equal(result.manifest.textureConversions[0].status, "not-converted");
  assert.match(result.manifest.textureConversions[0].error, /Only BC1/);
  const archive = await JSZip.loadAsync(result.blob);
  assert.equal(archive.file("AutoPort-Prep/ps4-texture-storage-candidates/textures/unsupported.dds.ps4tex.bin"), null);
  assert.ok(archive.file("AutoPort-Prep/source-original/textures/unsupported.dds"));
});


test("converts supported DDS files discovered inside recursively extracted RPF archives", async () => {
  const dds = makeDdsFixture({ width: 16, height: 16, fourCC: "DXT1", mipCount: 3 });
  const rpf = buildOpenRpf7([{ path: "textures/car_diffuse.dds", bytes: dds }]).bytes;
  const result = await buildAutomaticPrepBundle({
    target: { titleId: "CUSA00419", updateVersion: "1.57" },
    files: [{ path: "cars/sample/dlc.rpf", bytes: rpf }]
  });
  const sourcePath = "rpf-extracted/cars/sample/dlc.rpf/textures/car_diffuse.dds";
  assert.equal(result.manifest.summary.rpfRawFilesAnalyzed, 1);
  assert.equal(result.manifest.summary.ps4TextureStorageCandidates, 1);
  assert.equal(result.manifest.textureConversions[0].sourcePath, sourcePath);
  assert.equal(result.manifest.textureConversions[0].roundTripVerified, true);
  const item = result.manifest.deliveryPlan.items.find((entry) => entry.path === sourcePath);
  assert.equal(item.status, "partial-conversion");
  assert.equal(item.route, "ps4-texture-storage-candidate-only");
  const archive = await JSZip.loadAsync(result.blob);
  assert.ok(archive.file("AutoPort-Prep/source-original/cars/sample/dlc.rpf"));
  assert.ok(archive.file("AutoPort-Prep/rpf-extracted/cars/sample/dlc.rpf/textures/car_diffuse.dds"));
  assert.ok(archive.file("AutoPort-Prep/ps4-texture-storage-candidates/" + sourcePath + ".ps4tex.bin"));
});


test("groups duplicate imported content by SHA-256 without deleting either source file", async () => {
  const shared = new Uint8Array([0x42, 0x59, 0x54, 0x45, 0x50, 0x52, 0x49, 0x53, 0x4f, 0x4e]);
  const result = await buildAutomaticPrepBundle({
    files: [
      { path: "assets/first.dat", bytes: shared },
      { path: "assets/copy/second.dat", bytes: shared.slice() }
    ]
  });
  assert.equal(result.manifest.summary.duplicateContentGroups, 1);
  assert.equal(result.manifest.duplicateContentGroups[0].references.length, 2);
  const archive = await JSZip.loadAsync(result.blob);
  assert.ok(archive.file("AutoPort-Prep/source-original/assets/first.dat"));
  assert.ok(archive.file("AutoPort-Prep/source-original/assets/copy/second.dat"));
  const report = JSON.parse(await archive.file("AutoPort-Prep/reports/duplicate-content.json").async("string"));
  assert.equal(report.length, 1);
  assert.equal(report[0].references.length, 2);
  assert.match(report[0].sha256, /^[a-f0-9]{64}$/);
});
