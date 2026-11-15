import test from "node:test";
import assert from "node:assert/strict";
import { inspectModDocumentation } from "../src/core/documentation.js";

test("reads English and UTF-16 Chinese mod instructions as inert text", () => {
  const english = new TextEncoder().encode("Install with OpenIV. Copy dlcpacks/skyline/dlc.rpf to mods/update/x64/dlcpacks.");
  const chineseText = "安装说明：将 dlc.rpf 放入 dlcpacks 文件夹。";
  const chinese = new Uint8Array(2 + chineseText.length * 2);
  chinese[0] = 0xff; chinese[1] = 0xfe;
  for (let i = 0; i < chineseText.length; i++) { chinese[2 + i * 2] = chineseText.charCodeAt(i) & 255; chinese[3 + i * 2] = chineseText.charCodeAt(i) >> 8; }
  const reports = inspectModDocumentation([
    { path: "readmeEN.txt", bytes: english },
    { path: "安装说明CH.txt", bytes: chinese },
  ]);
  assert.equal(reports.length, 2);
  assert.match(reports[0].preview, /Install with OpenIV/);
  assert.ok(reports[0].pathHints.length > 0);
  assert.match(reports[1].preview, /安装说明/);
  assert.equal(reports[1].encoding, "UTF-16 LE");
});

test("does not include binary resources or execute documentation", () => {
  const reports = inspectModDocumentation([{ path: "dlc.rpf", bytes: new Uint8Array([0, 1, 2]) }]);
  assert.equal(reports.length, 0);
});
