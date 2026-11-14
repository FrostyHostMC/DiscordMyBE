import test from "node:test";
import assert from "node:assert/strict";
import { isRagekitCandidate } from "../src/core/ragekit.js";

test("includes RPF archives in native-engine intake", () => {
  assert.equal(isRagekitCandidate("update/x64/dlcpacks/custom/dlc.rpf"), true);
});

test("includes supported loose RAGE resource files", () => {
  for (const extension of [".yft", ".ydr", ".ydd", ".ytd", ".ybn", ".ymap", ".ytyp", ".awc"]) {
    assert.equal(isRagekitCandidate(`asset${extension}`), true, extension);
  }
});

test("does not send unrelated files to the native RAGE engine", () => {
  for (const path of ["readme.txt", "trainer.asi", "plugin.dll", "texture.png", ""]) {
    assert.equal(isRagekitCandidate(path), false, path);
  }
});
