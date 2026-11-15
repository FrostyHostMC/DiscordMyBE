import { PS4_TARGET } from "./target.js";

const REQUIRED_EVIDENCE = [
  ["console", "Target profile recorded (user-reported)", "Installed title ID and update still need direct console verification."],
  ["goldhen", "GoldHEN version recorded (user-reported)", "Runtime plugin loading and enabled features still need on-console verification."],
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
  const evidence = {
    console: consoleVerified === true || target.source === "user-confirmed",
    goldhen: (typeof goldhenVersion === "string" && goldhenVersion.trim().length > 0) || target.goldhenVersionSource === "user-confirmed",
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
    schemaVersion: 1,
    target: {
      titleId: target.titleId,
      updateVersion: target.updateVersion,
      mode: target.mode,
    },
    status: passed === gates.length ? "validated" : "blocked",
    passed,
    total: gates.length,
    conversionAllowed: false,
    deploymentAllowed: false,
    gates,
    note: "The target and GoldHEN details are recorded from the user, not independently verified on-console. RSC7 headers and PC-only inspection reports do not establish PS4 resource compatibility.",
  };
}
