import test from "node:test";
import assert from "node:assert/strict";
import { buildLegacyConvertArgs } from "../resource-convert-plugin.js";

test("uses the documented RageKit convert input output edition argument order", () => {
  assert.deepEqual(buildLegacyConvertArgs("source.yft", "target.yft"), ["convert", "source.yft", "target.yft", "--legacy"]);
});
