import test from "node:test";
import assert from "node:assert/strict";
import { inspectRsc7 } from "../src/core/rsc7.js";

function resource(extension, version) {
  const bytes = new Uint8Array(20);
  bytes.set([0x52, 0x53, 0x43, 0x37]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, version, true);
  view.setUint32(8, 0x1234, true);
  view.setUint32(12, 0x5678, true);
  return inspectRsc7(bytes, `sample${extension}`);
}

test("reads the RSC7 header without claiming platform compatibility", () => {
  const result = resource(".yft", 162);
  assert.equal(result.valid, true);
  assert.equal(result.version, 162);
  assert.equal(result.fixtureVersionMatch, true);
  assert.equal(result.platform, "undetermined");
  assert.equal(result.systemFlags, 0x1234);
});

test("recognizes the known legacy YTD version", () => {
  assert.equal(resource(".ytd", 13).fixtureVersionMatch, true);
});

test("rejects a non-RSC7 file", () => {
  assert.equal(inspectRsc7(new Uint8Array(20), "sample.yft").status, "not-rsc7");
});

test("rejects truncated headers", () => {
  assert.equal(inspectRsc7(new Uint8Array(8), "sample.yft").valid, false);
});

test("does not assume a platform for unknown versions", () => {
  const result = resource(".yft", 999);
  assert.equal(result.fixtureVersionMatch, false);
  assert.equal(result.platform, "undetermined");
});
