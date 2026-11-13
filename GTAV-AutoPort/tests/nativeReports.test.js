import test from "node:test";
import assert from "node:assert/strict";
import { inspectNativeReports } from "../src/core/nativeReports.js";

function file(path, value) {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
  return { path, bytes, size: bytes.length };
}

const base = { schema_version: 1, tool: "GTAV AutoPort Native Inspector", parse_result: "success" };

test("loads YFT report and its structural summary", () => {
  const report = { ...base, resource_type: "YFT", fragment: { name: "glendale", main_drawable: { model_count: 3 } } };
  const result = inspectNativeReports([file("yft/yft-inspection.json", report)]);
  assert.equal(result.yft.fragment.name, "glendale");
  assert.equal(result.yft.fragment.main_drawable.model_count, 3);
  assert.equal(result.ytd, null);
});

test("links YTD PNG preview files to their texture records", () => {
  const report = { ...base, resource_type: "YTD", textures: [{ name: "body", preview_png: "previews/body_0.png" }] };
  const png = { path: "previews/body_0.png", bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), size: 4 };
  const result = inspectNativeReports([file("ytd-inspection.json", report), png]);
  assert.equal(result.ytd.textures[0].previewAvailable, true);
  assert.deepEqual([...result.ytd.textures[0].previewBytes], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("rejects missing report files", () => {
  assert.throws(() => inspectNativeReports([]), /No yft-inspection/);
});

test("rejects unsupported report schema", () => {
  assert.throws(() => inspectNativeReports([file("yft-inspection.json", { ...base, schema_version: 9, resource_type: "YFT" })]), /Unsupported/);
});

test("rejects multiple reports of the same type", () => {
  const report = { ...base, resource_type: "YFT" };
  assert.throws(() => inspectNativeReports([file("a/yft-inspection.json", report), file("b/yft-inspection.json", report)]), /Multiple reports/);
});

test("rejects a YFT report without its fragment summary", () => {
  assert.throws(() => inspectNativeReports([file("yft-inspection.json", { ...base, resource_type: "YFT" })]), /fragment summary/);
});

test("does not follow unsafe preview paths", () => {
  const report = { ...base, resource_type: "YTD", textures: [{ name: "body", preview_png: "../outside.png" }] };
  const png = { path: "outside.png", bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), size: 8 };
  const result = inspectNativeReports([file("ytd-inspection.json", report), png]);
  assert.equal(result.ytd.textures[0].previewAvailable, false);
});

test("rejects a matching file without a PNG signature", () => {
  const report = { ...base, resource_type: "YTD", textures: [{ name: "body", preview_png: "previews/body.png" }] };
  const fake = { path: "previews/body.png", bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), size: 8 };
  const result = inspectNativeReports([file("ytd-inspection.json", report), fake]);
  assert.equal(result.ytd.textures[0].previewAvailable, false);
});

test("loads multiple named YFT reports for main and high-detail models", () => {
  const main = { ...base, resource_type: "YFT", source_file: "glendale.yft", fragment: { name: "glendale" } };
  const high = { ...base, resource_type: "YFT", source_file: "glendale_hi.yft", fragment: { name: "glendale_hi" } };
  const result = inspectNativeReports([
    file("glendale-yft-inspection.json", main),
    file("glendale_hi-yft-inspection.json", high),
  ]);
  assert.equal(result.yftReports.length, 2);
  assert.equal(result.yftReports[0].fragment.name, "glendale");
  assert.equal(result.yftReports[1].fragment.name, "glendale_hi");
});
