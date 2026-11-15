import test from "node:test";
import assert from "node:assert/strict";
import { buildAfrOverlayPlan, buildAfrPluginIniSnippet } from "../src/core/afr.js";

test("builds a title-specific GoldHEN AFR plugin configuration snippet", () => {
  const snippet = buildAfrPluginIniSnippet();
  assert.match(snippet, /\[CUSA00411\]/);
  assert.match(snippet, /\/data\/GoldHEN\/plugins\/afr\.prx=true/);
  assert.match(snippet, /does not install afr\.prx/i);
});

test("only maps explicitly supplied app0 paths into the AFR overlay", () => {
  const result = buildAfrOverlayPlan({
    files: [{ path: "durango.yft", size: 123 }, { path: "readme.txt", size: 5 }],
    mappings: { "durango.yft": "/app0/update/x64/dlcpacks/durango/dlc.rpf" },
  });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].stagingPath, "/data/GoldHEN/AFR/CUSA00411/update/x64/dlcpacks/durango/dlc.rpf");
  assert.equal(result.summary.unmappedFiles, 1);
  assert.equal(result.summary.deploymentAllowed, false);
});

test("rejects traversal, encoded separators, Windows paths, and non-app0 guesses", () => {
  for (const appPath of ["/app0/../outside", "/app0/%2e%2e/outside", "/app0/folder\\file", "/data/GoldHEN/file"]) {
    assert.throws(() => buildAfrOverlayPlan({
      files: [{ path: "mod.bin" }],
      mappings: { "mod.bin": appPath },
    }), /unsafe|explicit \/app0/i, appPath);
  }
});

test("rejects duplicate AFR destination paths", () => {
  assert.throws(() => buildAfrOverlayPlan({
    files: [{ path: "one.bin" }, { path: "two.bin" }],
    mappings: { "one.bin": "/app0/update/file.bin", "two.bin": "/app0/UPDATE/FILE.BIN" },
  }), /same AFR destination/i);
});

test("validates the target title ID before creating plugin configuration", () => {
  assert.throws(() => buildAfrPluginIniSnippet({ titleId: "CUSA0041", updateVersion: "1.73", mode: "Story Mode" }), /valid CUSA/i);
});
