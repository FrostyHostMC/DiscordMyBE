import test from "node:test";
import assert from "node:assert/strict";
import { analyzeModDependencies } from "../src/core/modDependencyGraph.js";

const bytes = (text) => new TextEncoder().encode(text);

test("resolves relative metadata references without depending on mod names or layouts", () => {
  const result = analyzeModDependencies([
    { path: "dlc/data/content.xml", bytes: bytes('<Item>vehicles.meta</Item><Item>handling.meta</Item>') },
    { path: "dlc/data/vehicles.meta", bytes: bytes("<Vehicles/>") },
    { path: "dlc/data/handling.meta", bytes: bytes("<Handling/>") }
  ]);
  assert.equal(result.summary.references, 2);
  assert.equal(result.summary.resolved, 2);
  assert.deepEqual(result.edges.map((edge) => edge.status), ["resolved", "resolved"]);
});

test("reports missing and ambiguous references instead of guessing", () => {
  const result = analyzeModDependencies([
    { path: "root/manifest.xml", bytes: bytes('<A>missing.ytd</A><B>shared.ytd</B>') },
    { path: "one/shared.ytd", bytes: new Uint8Array([1]) },
    { path: "two/shared.ytd", bytes: new Uint8Array([2]) }
  ]);
  assert.equal(result.summary.missing, 1);
  assert.equal(result.summary.ambiguous, 1);
  assert.equal(result.edges.find((edge) => edge.reference === "missing.ytd").status, "missing");
  assert.deepEqual(result.edges.find((edge) => edge.reference === "shared.ytd").targets, ["one/shared.ytd", "two/shared.ytd"]);
});

test("deduplicates repeated references and does not execute script content", () => {
  const result = analyzeModDependencies([
    { path: "scripts/config.lua", bytes: bytes('local a = "assets/car.yft"\nlocal b = "assets/car.yft"\nos.execute("danger")') },
    { path: "scripts/assets/car.yft", bytes: new Uint8Array([1]) }
  ]);
  assert.equal(result.summary.references, 1);
  assert.equal(result.edges[0].status, "resolved");
});

test("bounds text scanning and rejects traversal outside the imported package", () => {
  const oversized = new Uint8Array(2 * 1024 * 1024 + 1);
  const result = analyzeModDependencies([
    { path: "manifest.xml", bytes: bytes('<File>"../../outside.meta"</File>') },
    { path: "huge.xml", bytes: oversized }
  ]);
  assert.equal(result.summary.references, 1);
  assert.equal(result.edges[0].status, "missing");
  assert.equal(result.summary.ignoredOversizeTextFiles, 1);
  assert.equal(result.status, "read-only-reference-analysis");
});

test("scans BOM-marked UTF-16 metadata commonly exported by Windows tools", () => {
  const source = '<Item>common\\\\data\\\\handling.meta</Item>';
  const encoded = new TextEncoder().encode(source);
  const utf16 = new Uint8Array(2 + encoded.length * 2);
  utf16[0] = 0xff;
  utf16[1] = 0xfe;
  for (let index = 0; index < encoded.length; index += 1) utf16[2 + index * 2] = encoded[index];
  const result = analyzeModDependencies([
    { path: "dlc/content.xml", bytes: utf16 },
    { path: "dlc/common/data/handling.meta", bytes: bytes("<Handling/>") }
  ]);
  assert.equal(result.summary.references, 1);
  assert.equal(result.summary.resolved, 1);
});
