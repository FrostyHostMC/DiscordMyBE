import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { inspectZipArchive, inspectFolderFiles, classifyVehicleAssets, findByBasename } from "../src/core/intake.js";

async function asUpload(zip, name = "fixture.zip") {
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const blob = new Blob([bytes]);
  Object.defineProperty(blob, "name", { value: name });
  return blob;
}

test("imports a ZIP and inventories files", async () => {
  const zip = new JSZip();
  zip.file("vehicles.meta", "<root/>");
  zip.file("models/glendale.yft", new Uint8Array([0x52, 0x53, 0x43, 0x37]));
  zip.file("models/glendale_hi.yft", "model");
  zip.file("models/glendale.ytd", "texture");
  const result = await inspectZipArchive(await asUpload(zip));
  assert.equal(result.files.length, 4);
  assert.equal(result.inventory.find((item) => item.path === "vehicles.meta").extension, ".meta");
  const checks = classifyVehicleAssets(result.files, "glendale");
  assert.equal(checks.every((item) => item.present), true);
});

test("imports an OpenIV OIV package and identifies its assembly manifest", async () => {
  const oiv = new JSZip();
  oiv.file("assembly.xml", '<package><metadata><name>Example vehicle</name><version>1.2</version><author>Modder</author></metadata><content><add source="vehicle.yft" dest="update/x64/dlcpacks/example/vehicle.yft"/></content></package>');
  oiv.file("content/vehicles/example.yft", "model");
  const result = await inspectZipArchive(await asUpload(oiv, "example.oiv"));
  assert.equal(result.containerFormat, "openiv-oiv");
  assert.equal(result.packageMetadata.assemblyDetected, true);
  assert.deepEqual(result.packageMetadata.assemblyFiles, ["assembly.xml"]);
  assert.equal(result.packageMetadata.assemblies[0].name, "Example vehicle");
  assert.equal(result.packageMetadata.assemblies[0].version, "1.2");
  assert.equal(result.packageMetadata.assemblies[0].operationCount, 1);
  assert.equal(result.packageMetadata.assemblies[0].operations[0].action, "add");
  assert.equal(result.files.length, 2);
});

test("imports OIV containers without assuming they have a valid OpenIV manifest", async () => {
  const oiv = new JSZip();
  oiv.file("readme.txt", "not a standard package layout");
  const result = await inspectZipArchive(await asUpload(oiv, "loose-package.oiv"));
  assert.equal(result.packageMetadata.status, "manifest-missing");
});

test("rejects unsupported archive types", async () => {
  await assert.rejects(() => inspectZipArchive({ name: "mod.rar" }), /ZIP or OpenIV OIV/);
});

test("rejects parent traversal entries", async () => {
  const zip = new JSZip();
  zip.file("../outside.txt", "nope");
  const upload = await asUpload(zip);
  await assert.rejects(() => inspectZipArchive(upload), /Absolute paths|traversal/i);
});

test("imports a selected folder using relative paths", async () => {
  const files = [
    new File(["<root/>"], "vehicles.meta", { type: "text/xml" }),
    new File(["model"], "glendale.yft"),
  ];
  Object.defineProperty(files[0], "webkitRelativePath", { value: "my-mod/vehicles.meta" });
  Object.defineProperty(files[1], "webkitRelativePath", { value: "my-mod/models/glendale.yft" });
  const result = await inspectFolderFiles(files);
  assert.equal(result.sourceName, "my-mod");
  assert.deepEqual(result.inventory.map((item) => item.path), ["vehicles.meta", "models/glendale.yft"]);
});

test("rejects duplicate metadata basenames rather than picking an arbitrary file", () => {
  const files = [{ path: "one/vehicles.meta" }, { path: "two/vehicles.meta" }];
  assert.throws(() => findByBasename(files, "vehicles.meta"), /multiple files/);
});

test("marks duplicate vehicle assets ambiguous", () => {
  const files = [{ path: "a/glendale.yft", size: 10 }, { path: "b/glendale.yft", size: 20 }];
  const result = classifyVehicleAssets(files, "glendale");
  assert.equal(result[0].ambiguous, true);
  assert.equal(result[0].size, 30);
});
