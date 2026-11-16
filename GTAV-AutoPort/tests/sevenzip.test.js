import test from "node:test";
import assert from "node:assert/strict";
import { inspect7zArchive } from "../src/core/sevenZip.js";

function upload(name = "sample.7z", bytes = new Uint8Array([1, 2, 3])) {
  const file = new Blob([bytes]);
  Object.defineProperty(file, "name", { value: name });
  return file;
}

function response(payload, ok = true) {
  return { ok, json: async () => payload };
}

test("sends a 7z archive to the local extractor and builds a file inventory", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/__autoport/extract-7z");
    const request = JSON.parse(options.body);
    assert.equal(request.name, "durango.7z");
    assert.ok(request.data.length > 0);
    return response({
      sourceName: "durango.7z",
      files: [{ path: "dlc/vehicles.meta", size: 4, data: btoa("meta") }, { path: "dlc/durango.yft", size: 5, data: btoa("model") }],
    });
  };
  try {
    const result = await inspect7zArchive(upload("durango.7z"));
    assert.equal(result.containerFormat, "7z");
    assert.equal(result.files.length, 2);
    assert.equal(result.inventory[1].extension, ".yft");
    assert.equal(new TextDecoder().decode(result.files[1].bytes), "model");
    assert.equal(result.totalBytes, 9);
  } finally { globalThis.fetch = previousFetch; }
});

test("rejects unsafe paths returned by the local extractor", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => response({ sourceName: "bad.7z", files: [{ path: "../outside.txt", size: 1, data: btoa("x") }] });
  try { await assert.rejects(() => inspect7zArchive(upload()), /Unsafe extracted path/); }
  finally { globalThis.fetch = previousFetch; }
});

test("rejects duplicate paths returned by the local extractor", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => response({ sourceName: "dup.7z", files: [{ path: "A.txt", size: 1, data: btoa("x") }, { path: "a.TXT", size: 1, data: btoa("y") }] });
  try { await assert.rejects(() => inspect7zArchive(upload()), /Duplicate extracted path/); }
  finally { globalThis.fetch = previousFetch; }
});

test("rejects invalid archive types and oversized compressed inputs", async () => {
  await assert.rejects(() => inspect7zArchive(upload("mod.rar")), /Choose a .7z archive/);
  const huge = upload("huge.7z", new Uint8Array([1]));
  Object.defineProperty(huge, "size", { value: 160 * 1024 * 1024 + 1 });
  await assert.rejects(() => inspect7zArchive(huge), /160 MiB/);
});

test("rejects local extractor errors without masking their explanation", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => response({ error: "Encrypted 7z entry cannot be inspected without a password." }, false);
  try { await assert.rejects(() => inspect7zArchive(upload()), /Encrypted 7z entry/); }
  finally { globalThis.fetch = previousFetch; }
});
