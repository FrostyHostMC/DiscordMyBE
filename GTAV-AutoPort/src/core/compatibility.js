import { PS4_TARGET } from "./target.js";

const REQUIRED_EVIDENCE = [
  ["console", "Target profile recorded (user-reported)", "Verify the installed title ID and update directly on the console."],
  ["goldhen", "GoldHEN version recorded (user-reported)", "Verify runtime plugin loading and enabled features on-console."],
  ["yftReference", "Verified PS4 YFT reference available", "Inspect a legally obtained YFT from the exact target game build."],
  ["ytdReference", "Verified PS4 YTD reference available", "Inspect a legally obtained YTD from the exact target game build."],
  ["yftAdapter", "PS4 YFT conversion adapter implemented", "A writer must preserve required fragment, drawable, geometry, and resource structures."],
  ["ytdAdapter", "PS4 YTD conversion adapter implemented", "A writer must encode textures and dictionary structures for the verified target."],
  ["deployment", "Deployment and rollback paths validated", "Verify the exact replacement path and a tested restoration procedure."],
];

export function assessPs4Compatibility({
  target = PS4_TARGET,
  consoleVerified = false,
  goldhenVersion = null,
  ps4ReferenceResources = {},
  adapters = {},
  deploymentValidated = false,
} = {}) {
  const userConfirmedTarget = target.source === "user-confirmed";
  const evidence = {
    console: consoleVerified === true || userConfirmedTarget,
    goldhen: (typeof goldhenVersion === "string" && goldhenVersion.trim().length > 0)
      || target.goldhenVersionSource === "user-confirmed",
    yftReference: ps4ReferenceResources.yft === true,
    ytdReference: ps4ReferenceResources.ytd === true,
    yftAdapter: adapters.yft === true,
    ytdAdapter: adapters.ytd === true,
    deployment: deploymentValidated === true,
  };

  const gates = REQUIRED_EVIDENCE.map(([id, label, nextStep]) => ({
    id,
    label,
    nextStep,
    passed: evidence[id],
  }));
  const passed = gates.filter((gate) => gate.passed).length;

  return {
    schemaVersion: 2,
    target: {
      titleId: target.titleId,
      region: target.region ?? null,
      updateVersion: target.updateVersion,
      mode: target.mode,
      profileSource: target.source ?? "unknown",
    },
    status: passed === gates.length ? "validated" : "blocked",
    passed,
    total: gates.length,
    conversionAllowed: false,
    deploymentAllowed: false,
    gates,
    note: "Title ID recognition is not executable or resource compatibility. US and EU builds require independently verified fingerprints, hook signatures, resource references, adapters, and deployment tests. PC-side inspection and round trips do not establish PS4 compatibility.",
  };
}
