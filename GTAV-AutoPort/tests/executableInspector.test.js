import test from "node:test";
import assert from "node:assert/strict";
import { inspectExecutableHeader } from "../src/core/executableInspector.js";

function elf64({ machine = 62, osAbi = 0, phnum = 0, phoff = 64 } = {}) {
  const bytes = new Uint8Array(256);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, osAbi, 0]);
  const view = new DataView(bytes.buffer);
  view.setUint16(16, 3, true);
  view.setUint16(18, machine, true);
  view.setUint32(20, 1, true);
  view.setBigUint64(24, 0x400000n, true);
  view.setBigUint64(32, BigInt(phoff), true);
  view.setUint16(52, 64, true);
  view.setUint16(54, 56, true);
  view.setUint16(56, phnum, true);
  view.setUint16(58, 64, true);
  view.setUint16(60, 0, true);
  return bytes;
}

test("inspects ELF64 x86-64 without claiming Orbis compatibility", () => {
  const result = inspectExecutableHeader({ path: "plugin.sprx", bytes: elf64({ osAbi: 9 }) });
  assert.equal(result.status, "header-inspected");
  assert.equal(result.class, 64);
  assert.equal(result.machineName, "x86-64");
  assert.equal(result.architectureCompatibleWithPs4Cpu, true);
  assert.equal(result.platform, "unverified");
  assert.equal(result.targetCompatibility, "unverified");
  assert.ok(result.warnings.some((warning) => warning.includes("does not establish Orbis ABI")));
});

test("flags wrong ELF architecture instead of trusting the extension", () => {
  const result = inspectExecutableHeader({ path: "plugin.prx", bytes: elf64({ machine: 40 }) });
  assert.equal(result.machineName, "ARM");
  assert.equal(result.architectureCompatibleWithPs4Cpu, false);
});

test("rejects truncated ELF headers and program-header tables", () => {
  assert.equal(inspectExecutableHeader(new Uint8Array([0x7f, 0x45, 0x4c, 0x46])).status, "truncated");
  const bytes = elf64({ phnum: 1, phoff: 240 });
  assert.equal(inspectExecutableHeader(bytes).status, "header-only");
});

test("identifies Windows PE and reports it cannot be used as a PS4 plugin", () => {
  const bytes = new Uint8Array(512);
  const view = new DataView(bytes.buffer);
  bytes.set([0x4d, 0x5a]);
  view.setUint32(0x3c, 0x80, true);
  view.setUint32(0x80, 0x00004550, true);
  view.setUint16(0x84, 0x8664, true);
  view.setUint16(0x86, 3, true);
  view.setUint16(0x94, 0xf0, true);
  view.setUint16(0x96, 0x2022, true);
  view.setUint16(0x98, 0x20b, true);
  const result = inspectExecutableHeader({ path: "mod.dll", bytes });
  assert.equal(result.status, "header-inspected");
  assert.equal(result.machineName, "x86-64");
  assert.equal(result.optionalHeaderBits, 64);
  assert.equal(result.platform, "windows-pe");
  assert.equal(result.targetCompatibility, "not-a-PS4-native-module");
});

test("recognizes opaque Sony SCE containers without claiming they are valid PRX files", () => {
  const result = inspectExecutableHeader(new Uint8Array([0x53, 0x43, 0x45, 0x00, 1, 2, 3, 4]));
  assert.equal(result.format, "sce-container");
  assert.equal(result.status, "opaque-console-container");
  assert.equal(result.targetCompatibility, "unverified");
});

test("rejects malformed MZ files and unknown binaries conservatively", () => {
  assert.equal(inspectExecutableHeader(new Uint8Array([0x4d, 0x5a])).status, "truncated");
  assert.equal(inspectExecutableHeader(new Uint8Array([1, 2, 3])).status, "unrecognized");
});


test("recognizes the PlayStation SELF container magic without decrypting it", () => {
  const result = inspectExecutableHeader(new Uint8Array([0x4f, 0x15, 0x3d, 0x1d, 1, 2, 3, 4]));
  assert.equal(result.format, "self-container");
  assert.equal(result.status, "opaque-console-container");
  assert.equal(result.magic, "4f153d1d");
  assert.equal(result.targetCompatibility, "unverified");
});


test("rejects ELF64 addresses outside JavaScript safe-integer bounds", () => {
  const bytes = elf64();
  new DataView(bytes.buffer).setBigUint64(24, 0x20000000000000n, true);
  const result = inspectExecutableHeader(bytes);
  assert.equal(result.status, "invalid-header");
  assert.match(result.error, /safe-integer range/);
});
