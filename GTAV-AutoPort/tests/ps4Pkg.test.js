import test from "node:test";
import assert from "node:assert/strict";
import { inspectPs4Pkg } from "../src/core/ps4Pkg.js";

function makePkg() {
  const bytes = new Uint8Array(0x1200);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x7f434e54, false);
  view.setUint32(0x10, 1, false);
  view.setUint32(0x18, 0x1000, false);
  new TextEncoder().encode("EP0001-CUSA00411_00-GTAVGAME00000001").forEach((b,i)=>bytes[0x40+i]=b);
  view.setUint32(0x78, 0x02000000, false);
  view.setUint32(0x1000, 0x1000, false);
  view.setUint32(0x1000+16, 0x1100, false);
  view.setUint32(0x1000+20, 0x100, false);
  // One entry points to a compact, valid PARAM.SFO.
  view.setUint32(0x1100, 0x46535000, true);
  view.setUint32(0x1108, 0x30, true);
  view.setUint32(0x110c, 0x40, true);
  view.setUint32(0x1110, 1, true);
  view.setUint16(0x1114, 0, true);
  view.setUint16(0x1116, 0x0204, true);
  view.setUint32(0x1118, 4, true);
  view.setUint32(0x1120, 16, true);
  bytes.set(new TextEncoder().encode("CATEGORY\0"), 0x1130);
  bytes.set(new TextEncoder().encode("gp\0\0"), 0x1140);
  const entry = new DataView(bytes.buffer);
  entry.setUint32(0x1000, 0x1000, false);
  entry.setUint32(0x1000+16, 0x1100, false);
  entry.setUint32(0x1000+20, 0x100, false);
  return { name: "update.pkg", size: bytes.length, slice: (start,end)=>new Blob([bytes.slice(start,end)]) };
}

test("inspects PS4 PKG header and identifies title ID without opening payload", async () => {
  const report = await inspectPs4Pkg(makePkg());
  assert.equal(report.titleId, "CUSA00411");
  assert.equal(report.packageType, "update-candidate");
  assert.equal(report.compatibilityVerified, false);
});

test("rejects non-PS4 package signatures", async () => {
  const file = { name: "bad.pkg", size: 4096, slice: (a,b)=>new Blob([new Uint8Array(b-a)]) };
  await assert.rejects(inspectPs4Pkg(file), /does not have a PS4 PKG header/);
});

test("rejects unreasonable metadata table counts", async () => {
  const bytes = new Uint8Array(4096);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x7f434e54, false);
  view.setUint32(0x10, 100001, false);
  const file = { name: "huge.pkg", size: bytes.length, slice: (a,b)=>new Blob([bytes.slice(a,b)]) };
  await assert.rejects(inspectPs4Pkg(file), /entry count/);
});
