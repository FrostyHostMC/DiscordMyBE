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


test("parses supplied INI bytes without inventing or normalizing undocumented values", () => {
  const ini = new TextEncoder().encode("; ORBX settings\n[Files]\nAvoidCrcCheckedFiles=1\nLoadMETA=true\n");
  const report = inspectOrbxPackage([
    { path: "package/orbx.prx", size: 100 },
    { path: "package/orbx/orbx.ini", bytes: ini },
    { path: "package/orbx/gta/handling.meta", size: 200 }
  ]);
  assert.equal(report.components.configuration.contentsInspected, true);
  assert.equal(report.components.configuration.iniAnalysis.status, "parsed");
  assert.equal(report.components.configuration.iniAnalysis.sections[0], "Files");
  assert.equal(report.components.configuration.iniAnalysis.hasAvoidCrcCheckedFiles, true);
  assert.equal(report.components.configuration.iniAnalysis.settings[1].key, "LoadMETA");
  assert.equal(report.installReview.runtimeCompatibilityVerified, false);
});

test("flags malformed and duplicate INI settings with line numbers", () => {
  const ini = new TextEncoder().encode("[Files]\nLoadMETA=true\nLoadMETA=false\nnot-a-setting\n");
  const report = inspectOrbxPackage([{ path: "orbx.ini", bytes: ini }, { path: "orbx.prx" }]);
  const analysis = report.components.configuration.iniAnalysis;
  assert.equal(analysis.status, "parsed-with-warnings");
  assert.equal(analysis.duplicateKeys.length, 1);
  assert.equal(analysis.duplicateKeys[0].line, 3);
  assert.deepEqual(analysis.malformedLines, [4]);
});

test("distinguishes RPF path marker files from actual RPF archives", () => {
  const report = inspectOrbxPackage([
    { path: "orbx.prx" },
    { path: "orbx.ini" },
    { path: "orbx/gta/rpf/levels/gta5/update.rpf.txt", size: 0 },
    { path: "ps4a.rpf", size: 51_662_848 }
  ]);
  assert.equal(report.components.resourceArchives.length, 1);
  assert.equal(report.components.resourceArchives[0].path, "ps4a.rpf");
  assert.equal(report.components.rpfPathMarkerCount, 1);
  assert.ok(report.warnings.some((message) => message.includes("not RPF archives")));
});

test("detects repeated package-folder nesting and reports supporting log files", () => {
  const report = inspectOrbxPackage([
    { path: "Orbx Engine v1.4/Orbx Engine v1.4/orbx.prx" },
    { path: "Orbx Engine v1.4/Orbx Engine v1.4/orbx/orbx.ini" },
    { path: "Orbx Engine v1.4/Orbx Engine v1.4/orbx/rpf_log.txt", size: 916419 }
  ]);
  assert.equal(report.packageLayout.hasRepeatedAdjacentFolderNames, true);
  assert.equal(report.components.runtimeLog.present, true);
  assert.ok(report.warnings.some((message) => message.includes("repeated adjacent folder names")));
});


test("extracts bounded diagnostic signals from an uploaded ORBX runtime log", () => {
  const log = new TextEncoder().encode([
    "ORBX startup",
    "Plugin version 1.4 initialized",
    "Unsupported game version",
    "CRC warning: skipped checked file",
    "All done"
  ].join("\n"));
  const report = inspectOrbxPackage([
    { path: "orbx.prx", size: 100 },
    { path: "orbx.ini", bytes: new TextEncoder().encode("[Files]\nLoadMETA=true\n") },
    { path: "orbx/rpf_log.txt", bytes: log }
  ]);
  const analysis = report.components.runtimeLog.analysis;
  assert.equal(analysis.status, "parsed-with-signals");
  assert.equal(analysis.lineCount, 5);
  assert.deepEqual(analysis.signals.map((item) => item.category), ["compatibility", "crc"]);
  assert.equal(analysis.signals[0].line, 3);
  assert.ok(report.warnings.some((message) => message.includes("diagnostic lines")));
});

test("does not parse oversized ORBX runtime logs", () => {
  const report = inspectOrbxPackage([
    { path: "orbx/rpf_log.txt", bytes: new Uint8Array(1024 * 1024 + 1) }
  ]);
  assert.equal(report.components.runtimeLog.analysis.status, "too-large-to-inspect");
  assert.equal(report.components.runtimeLog.analysis.signals.length, 0);
});
