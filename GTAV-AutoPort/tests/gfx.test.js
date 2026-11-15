import test from "node:test";
import assert from "node:assert/strict";
import { createEditableSwfCopy, inspectScaleformAsset, inspectScaleformAssets } from "../src/core/gfx.js";

function makeFile(signature, length = 12, declared = length) {
  const bytes = new Uint8Array(length);
  bytes.set([...signature].map((char) => char.charCodeAt(0)), 0);
  bytes[3] = 8;
  bytes[4] = declared & 255;
  bytes[5] = (declared >>> 8) & 255;
  bytes[6] = (declared >>> 16) & 255;
  bytes[7] = (declared >>> 24) & 255;
  return { path: "ui/font.gfx", extension: ".gfx", bytes, size: bytes.length };
}

test("inspects uncompressed Scaleform GFX headers", () => {
  const result = inspectScaleformAsset(makeFile("GFX"));
  assert.equal(result.validHeader, true);
  assert.equal(result.scaleform, true);
  assert.equal(result.compression, "none");
  assert.equal(result.version, 8);
});

test("inspects compressed Scaleform CFX headers without claiming payload validation", () => {
  const result = inspectScaleformAsset(makeFile("CFX", 10, 500));
  assert.equal(result.validHeader, true);
  assert.equal(result.compression, "zlib");
  assert.equal(result.payloadVerified, false);
});

test("recognizes ordinary SWF separately from Scaleform GFX", () => {
  const result = inspectScaleformAsset(makeFile("CWS", 10, 200));
  assert.equal(result.validHeader, true);
  assert.equal(result.scaleform, false);
  assert.equal(result.format, "SWF");
});

test("rejects malformed uncompressed lengths and unknown signatures", () => {
  assert.equal(inspectScaleformAsset(makeFile("GFX", 12, 99)).validHeader, false);
  assert.equal(inspectScaleformAsset(makeFile("BAD")).validHeader, false);
});

test("creates a separate editor handoff copy without mutating the original", () => {
  const source = makeFile("CFX", 10, 300);
  const original = source.bytes.slice();
  const copy = createEditableSwfCopy(source);
  assert.equal(String.fromCharCode(...copy.bytes.slice(0, 3)), "FWS");
  assert.equal(String.fromCharCode(...source.bytes.slice(0, 3)), "CFX");
  assert.deepEqual(source.bytes, original);
  assert.match(copy.filename, /editor-copy\.swf$/);
});

test("does not prepare ordinary SWF or invalid files as GFX editor copies", () => {
  assert.throws(() => createEditableSwfCopy(makeFile("CWS", 10, 300)), /GFX\/CFX/);
  assert.throws(() => createEditableSwfCopy(makeFile("GFX", 12, 99)), /GFX\/CFX/);
});

test("summarizes graphics assets without claiming PS4 compatibility", () => {
  const result = inspectScaleformAssets([makeFile("GFX"), makeFile("CWS", 10, 300)]);
  assert.equal(result.summary.files, 2);
  assert.equal(result.summary.scaleformGfx, 1);
  assert.equal(result.summary.ps4Compatible, false);
});
