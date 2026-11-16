import test from "node:test";
import assert from "node:assert/strict";
import { parseRpfListing } from "../src/core/rpf.js";

test("parses nested RPF TSV entries and summarizes resource families", () => {
  const listing = [
    "Resource\tstream/durango.yft\t1200\t900\t1200\t1\t2\t0",
    "Resource\tstream/durango.ytd\t800\t700\t800\t1\t2\t0",
    "Binary\tcontent.xml\t120\t100\t120\t0\t0\t0",
  ].join("\n");
  const result = parseRpfListing(listing);
  assert.equal(result.summary.entryCount, 3);
  assert.equal(result.summary.resourceCount, 2);
  assert.equal(result.summary.extensionCounts[".yft"], 1);
  assert.equal(result.summary.extensionCounts[".ytd"], 1);
  assert.equal(result.entries[0].path, "stream/durango.yft");
});

test("rejects path traversal, absolute paths, and Windows paths in RPF listings", () => {
  for (const unsafe of ["../outside.txt", "stream/../../outside.txt", "/root/file.yft", "C:/outside.yft", "stream\\outside.yft"]) {
    const listing = `Binary\t${unsafe}\t1\t1\t1\t0\t0\t0`;
    assert.throws(() => parseRpfListing(listing), /unsafe entry path/i, unsafe);
  }
});

test("rejects duplicate paths and malformed size fields", () => {
  const duplicate = [
    "Binary\tdata/file.meta\t1\t1\t1\t0\t0\t0",
    "Binary\tDATA/FILE.META\t1\t1\t1\t0\t0\t0",
  ].join("\n");
  assert.throws(() => parseRpfListing(duplicate), /duplicate entry paths/i);
  assert.throws(() => parseRpfListing("Binary\tdata/file.meta\tNaN\t1\t1\t0\t0\t0"), /invalid size metadata/i);
});

test("enforces an entry-count limit", () => {
  const rows = Array.from({ length: 10001 }, (_, index) => `Binary\tfile-${index}.meta\t1\t1\t1\t0\t0\t0`);
  assert.throws(() => parseRpfListing(rows.join("\n")), /entry inspection limit/i);
});
