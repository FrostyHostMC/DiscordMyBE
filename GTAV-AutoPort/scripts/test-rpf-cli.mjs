import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseRpfListing } from "../src/core/rpf.js";

const executable = process.argv[2];
if (!executable) throw new Error("Usage: node scripts/test-rpf-cli.mjs <path-to-rk>");
const temp = mkdtempSync(path.join(os.tmpdir(), "autoport-rpf-integration-"));
const run = (args) => execFileSync(executable, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
try {
  const source = path.join(temp, "source");
  const nested = path.join(source, "nested.rpf", "stream");
  mkdirSync(path.join(source, "stream"), { recursive: true });
  mkdirSync(nested, { recursive: true });
  writeFileSync(path.join(source, "stream", "vehicle.meta"), "<VehicleInfo><modelName>durango</modelName></VehicleInfo>");
  writeFileSync(path.join(nested, "nested-resource.txt"), "nested RPF payload");
  const archive = path.join(temp, "durango-test.rpf");
  run(["rpf", "pack", source, archive]);

  const listing = run(["rpf", "ls", archive, "-r", "--nested", "--tsv"]);
  const parsed = parseRpfListing(listing);
  assert.ok(parsed.entries.some((entry) => entry.path === "stream/vehicle.meta"), "root entry is listed");
  assert.ok(parsed.entries.some((entry) => entry.path === "nested.rpf/stream/nested-resource.txt"), "nested archive entry is listed");

  const extracted = path.join(temp, "nested-resource.txt");
  run(["rpf", "cat", archive, "nested.rpf/stream/nested-resource.txt", extracted]);
  assert.equal(readFileSync(extracted, "utf8"), "nested RPF payload");
  process.stdout.write(`RPF integration passed: ${parsed.summary.entryCount} entries, ${parsed.summary.resourceCount} RAGE resources, nested cat verified.\n`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
