import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listNativeOutputFiles } from "../native-inspection-plugin.js";

test("native output traversal returns files only and descends into nested folders", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autoport-native-output-test-"));
  try {
    await mkdir(path.join(root, "nested", "deeper"), { recursive: true });
    await mkdir(path.join(root, "empty-directory"));
    await writeFile(path.join(root, "root.json"), "{}");
    await writeFile(path.join(root, "nested", "deeper", "preview.png"), "png");
    const files = (await listNativeOutputFiles(root))
      .map(file => path.relative(root, file).split(path.sep).join("/"))
      .sort();
    assert.deepEqual(files, ["nested/deeper/preview.png", "root.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
