import test from "node:test";
import assert from "node:assert/strict";
import { convertLegacyResourceCandidate } from "../src/core/resourceConversion.js";

test("rejects formats outside the YFT/YTD writer before making a request", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("fetch must not be called"); };
  try { await assert.rejects(() => convertLegacyResourceCandidate({ path: "script.ysc", bytes: new Uint8Array([1]) }), /Only YFT and YTD/); }
  finally { globalThis.fetch = originalFetch; }
});

test("decodes a successful Legacy candidate response and keeps PS4 status unverified", async () => {
  const originalFetch = globalThis.fetch;
  const output = new Uint8Array([82, 65, 71, 69, 55]);
  const encoded = btoa(String.fromCharCode(...output));
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.name, "car.yft");
    return { ok: true, json: async () => ({ outputBase64: encoded, outputBytes: output.length, targetEdition: "GTA V PC Legacy resource format", ps4Compatibility: "unverified" }) };
  };
  try {
    const result = await convertLegacyResourceCandidate({ path: "car.yft", bytes: new Uint8Array([1, 2, 3]) });
    assert.deepEqual(result.bytes, output);
    assert.equal(result.ps4Compatibility, "unverified");
  } finally { globalThis.fetch = originalFetch; }
});

test("accepts drawable and collision resources through the same Legacy adapter", async () => {
  const originalFetch = globalThis.fetch;
  const output = new Uint8Array([1, 2, 3, 4]);
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.name, "prop.ydr");
    return { ok: true, json: async () => ({ outputBase64: btoa(String.fromCharCode(...output)), outputBytes: output.length, ps4Compatibility: "unverified" }) };
  };
  try {
    const result = await convertLegacyResourceCandidate({ path: "prop.ydr", bytes: new Uint8Array([9]) });
    assert.deepEqual(result.bytes, output);
  } finally { globalThis.fetch = originalFetch; }
});
