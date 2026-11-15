import test from "node:test";
import assert from "node:assert/strict";
import { inspectGtaDlcManifest } from "../src/core/dlcManifest.js";

test("extracts GTA V DLC data file references and resource types", () => {
  const xml = `<?xml version="1.0"?><CDataFileMgr__ContentsOfDataFileXml><dataFiles><Item><filename>dlc_skyline:/common/data/levels/gta5/vehicles.meta</filename><fileType>VEHICLE_METADATA_FILE</fileType></Item><Item><filename>dlc_skyline:/common/data/handling.meta</filename><fileType>HANDLING_FILE</fileType></Item></dataFiles><disabledFiles><Item>dlc_skyline:/common/data/old.meta</Item></disabledFiles></CDataFileMgr__ContentsOfDataFileXml>`;
  const report = inspectGtaDlcManifest(xml);
  assert.equal(report.validXml, true);
  assert.equal(report.summary.dataFiles, 2);
  assert.equal(report.summary.fileTypes.VEHICLE_METADATA_FILE, 1);
  assert.ok(report.entries.some((entry) => entry.filename.endsWith("vehicles.meta")));
  assert.equal(report.summary.disabledFiles, 1);
});

test("handles malformed and oversized manifests without executing instructions", () => {
  assert.equal(inspectGtaDlcManifest("<broken").validXml, false);
  assert.throws(() => inspectGtaDlcManifest("x".repeat(2 * 1024 * 1024 + 1)), /2 MiB/);
});
