import { PS4_TARGET } from "./target.js";
const REQUIRED_EVIDENCE = [
  ["console", "Console title and update confirmed", "Read the installed title ID and update version from the PS4 itself."],
  ["goldhen", "GoldHEN runtime confirmed", "Confirm the installed GoldHEN build and that the plugin loader is enabled."],
  ["yftReference", "Verified PS4 YFT reference available", "Inspect a legally obtained YFT from the exact regional target build."],
  ["ytdReference", "Verified PS4 YTD reference available", "Inspect a legally obtained YTD from the exact regional target build."],
  ["yftAdapter", "PS4 YFT conversion adapter implemented", "Validate fragment, drawable, geometry, and resource structures with round-trip fixtures."],
  ["ytdAdapter", "PS4 YTD conversion adapter implemented", "Validate texture encoding and dictionary structures against the exact target."],
  ["deployment", "Deployment and rollback paths validated", "Verify exact replacement paths and a tested restoration procedure."],
];
export function assessPs4Compatibility({ target = PS4_TARGET, consoleVerified = false, goldhenRuntimeVerified = false, goldhenVersion = null, ps4ReferenceResources = {}, adapters = {}, deploymentValidated = false } = {}) {
  const evidence = {
    console: consoleVerified === true,
    goldhen: goldhenRuntimeVerified === true && typeof goldhenVersion === "string" && goldhenVersion.trim().length > 0,
    yftReference: ps4ReferenceResources.yft === true,
    ytdReference: ps4ReferenceResources.ytd === true,
    yftAdapter: adapters.yft === true,
    ytdAdapter: adapters.ytd === true,
    deployment: deploymentValidated === true,
  };
  const gates = REQUIRED_EVIDENCE.map(([id, label, nextStep]) => ({ id, label, nextStep, passed: evidence[id] }));
  const passed = gates.filter((gate) => gate.passed).length;
  return {
    schemaVersion: 2,
    target: { titleId: target.titleId, region: target.region, updateVersion: target.updateVersion, mode: target.mode },
    status: passed === gates.length ? "evidence-complete" : "blocked",
    passed, total: gates.length, conversionAllowed: false, deploymentAllowed: false, gates,
    note: "Evidence completion is not proof that a converter or runtime works. Conversion and deployment remain disabled until real target-specific writers, validation, and console acceptance are implemented.",
  };
}
