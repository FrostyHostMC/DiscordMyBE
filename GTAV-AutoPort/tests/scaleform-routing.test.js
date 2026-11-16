import test from "node:test";
import assert from "node:assert/strict";
import { auditModFiles } from "../src/core/modClassifier.js";
import { buildUniversalPortPlan } from "../src/core/portPlan.js";

test("classifies Scaleform GFX, SWF, authoring and font source assets", () => {
  const result = auditModFiles([
    { path: "ui/font.gfx", size: 10 },
    { path: "ui/menu.swf", size: 20 },
    { path: "src/menu.fla", size: 30 },
    { path: "src/menu.as", size: 40 },
    { path: "fonts/custom.ttf", size: 50 },
  ]);
  assert.deepEqual(result.files.map((file) => file.family), [
    "scaleform-graphics", "scaleform-graphics", "scaleform-source", "scaleform-source", "font-source",
  ]);
});

test("routes GFX and SWF through the Scaleform-specific blocked pipeline", () => {
  const result = buildUniversalPortPlan({ files: [
    { path: "ui/font.gfx", size: 10 },
    { path: "ui/menu.swf", size: 20 },
  ] });
  assert.deepEqual(result.resources.map((item) => item.stage), ["scaleform-analysis", "scaleform-authoring"]);
  assert.ok(result.resources.every((item) => item.status === "blocked-pending-target-adapter"));
  assert.equal(result.summary.installable, false);
});
