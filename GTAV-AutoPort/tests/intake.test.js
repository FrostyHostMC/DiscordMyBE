import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { inspectZipArchive, classifyVehicleAssets } from "../src/core/intake.js";

async function asUpload(zip, name = "fixture.zip") {
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return { name, async: undefined, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

test("imports a ZIP and inventories files", async () => {
  const zip = new JSZip();
  zip.file("vehicles.meta", "<root/>");
  zip.file("models/glendale.yft", new Uint8Array([0x52, 0x53, 0x43, 0x37]));
  zip.file("models/glendale_hi.yft", "model");
  zip.file("models/glendale.ytd", "texture");
  const upload = await asUpload(zip);
  const result = await inspectZipArchive(upload);
  assert.equal(result.files.length, 4);
  assert.equal(result.inventory.find((item) => item.path === "vehicles.meta").extension, ".meta");
  const checks = classifyVehicleAssets(result.files, "glendale");
  assert.equal(checks.every((item) => item.present), true);
  assert.match(checks[0].signature, /RSC7/);
});

test("rejects a non-ZIP import", async () => {
  await assert.rejects(() => inspectZipArchive({ name: "mod.rar" }), /import a ZIP archive/);
});

test("rejects parent traversal entries", async () => {
  const zip = new JSZip();
  zip.file("../outside.txt", "nope");
  const upload = await asUpload(zip);
  await assert.rejects(() => inspectZipArchive(upload), /Unsafe|traversal/i);
});
