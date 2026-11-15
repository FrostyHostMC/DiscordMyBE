import test from "node:test";
import assert from "node:assert/strict";
import { buildAutomaticPrepBundle } from "../src/core/autoPortPrepBundle.js";

test("requires an imported mod", async () => {
  await assert.rejects(() => buildAutomaticPrepBundle({ files: [] }), /Import a PC mod/);
});

test("keeps the PS4 gate closed when there are no convertible resources", async () => {
  const result = await buildAutomaticPrepBundle({
    sourceName: "metadata-only",
    target: { titleId: "CUSA00419", updateVersion: "1.73" },
    files: [{ path: "vehicles.meta", bytes: new TextEncoder().encode("<CVehicleModelInfo__InitDataList/>") }]
  });
  assert.equal(result.manifest.summary.importedFiles, 1);
  assert.equal(result.manifest.summary.convertibleCandidates, 0);
  assert.equal(result.manifest.summary.ps4ReadyFiles, 0);
  assert.equal(result.manifest.summary.installable, false);
  assert.ok(result.blob.size > 0);
});
