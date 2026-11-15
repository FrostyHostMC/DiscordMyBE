import test from "node:test";
import assert from "node:assert/strict";
import { buildOpenRpf7 } from "../src/core/rpf7OpenBuilder.js";
import { inspectOpenRpf7 } from "../src/core/rpf7OpenInspector.js";

test("inspects a writer-produced nested OPEN archive", () => {
  const built = buildOpenRpf7([
    { path: "common/data/handling.meta", bytes: new TextEncoder().encode("<HandlingData/>") },
    { path: "content.xml", bytes: new Uint8Array([1, 2, 3]) }
  ]);
  const result = inspectOpenRpf7(built.bytes);
  assert.equal(result.encryption, "OPEN");
  assert.equal(result.fileCount, 2);
  assert.equal(result.directoryCount, 3);
  assert.ok(result.entries.some((entry) => entry.type === "file" && entry.name === "handling.meta" && entry.size === 15));
});

test("rejects truncated headers and tables", () => {
  assert.throws(() => inspectOpenRpf7(new Uint8Array(8)), /header is truncated/);
  const built = buildOpenRpf7([{ path: "a.bin", bytes: new Uint8Array([1]) }]);
  assert.throws(() => inspectOpenRpf7(built.bytes.subarray(0, 24)), /entry table is truncated|name table extends/);
});

test("rejects non-OPEN Orbis-style marker instead of guessing", () => {
  const built = buildOpenRpf7([{ path: "a.bin", bytes: new Uint8Array([1]) }]);
  const bytes = built.bytes.slice();
  new DataView(bytes.buffer).setUint32(12, 0x0ffeffff, true);
  assert.throws(() => inspectOpenRpf7(bytes), /not the supported OPEN variant/);
});

test("rejects payload offsets outside the archive", () => {
  const built = buildOpenRpf7([{ path: "a.bin", bytes: new Uint8Array([1]) }]);
  const bytes = built.bytes.slice();
  const view = new DataView(bytes.buffer);
  // First file is entry 1; overwrite its 24-bit block offset.
  bytes[16 + 16 + 5] = 0xff;
  bytes[16 + 16 + 6] = 0xff;
  bytes[16 + 16 + 7] = 0x7f;
  assert.throws(() => inspectOpenRpf7(bytes), /payload range is outside/);
});

test("rejects malformed UTF-8 names", () => {
  const built = buildOpenRpf7([{ path: "a.bin", bytes: new Uint8Array([1]) }]);
  const bytes = built.bytes.slice();
  const namesStart = 16 + 2 * 16;
  bytes[namesStart + 1] = 0xff;
  assert.throws(() => inspectOpenRpf7(bytes), /not valid UTF-8/);
});
