import { PS4_TARGET } from "./target.js";

const TITLE_ID = /^CUSA\d{5}$/;
const PLUGIN_PATH = "/data/GoldHEN/plugins/afr.prx";

function appRelativePath(value) {
  if (typeof value !== "string" || !value.startsWith("/app0/")) {
    throw new Error("AFR mappings must use an explicit /app0/... game path.");
  }
  if (value.includes("\\") || value.includes("\0") || /%(?:2e|2f|5c)/i.test(value)) {
    throw new Error("AFR mapping contains an unsafe encoded or Windows path.");
  }
  const parts = value.slice("/app0/".length).split("/");
  if (!parts.length || parts.some((part) => !part || part === "." || part === ".." || part.includes(":"))) {
    throw new Error("AFR mapping contains an unsafe path segment.");
  }
  return parts.join("/");
}

/** Generate a mergeable GoldHEN plugins.ini snippet; never overwrites an existing file. */
export function buildAfrPluginIniSnippet(target = PS4_TARGET) {
  if (!TITLE_ID.test(String(target.titleId || ""))) throw new Error("A valid CUSA title ID is required for a GoldHEN plugin section.");
  return `; AutoPort AFR overlay loader — merge into your existing plugins.ini
; Back up the original file first. This does not install afr.prx.
[${target.titleId}]
${PLUGIN_PATH}=true
`;
}

/**
 * Build a review-only overlay plan from explicit /app0 mappings.
 * Source paths are never guessed from PC mod folder names.
 */
export function buildAfrOverlayPlan({ files = [], mappings = {}, target = PS4_TARGET } = {}) {
  if (!TITLE_ID.test(String(target.titleId || ""))) throw new Error("A valid CUSA title ID is required for AFR staging.");
  const entries = [];
  const seen = new Set();
  for (const file of files) {
    const appPath = mappings[file.path];
    if (!appPath) continue;
    const relativePath = appRelativePath(appPath);
    const key = relativePath.toLowerCase();
    if (seen.has(key)) throw new Error(`Multiple source files map to the same AFR destination: ${appPath}`);
    seen.add(key);
    entries.push({
      sourcePath: file.path,
      appPath,
      stagingPath: `/data/GoldHEN/AFR/${target.titleId}/${relativePath}`,
      bytes: file.size ?? file.bytes?.byteLength ?? 0,
      status: "explicit-mapping-requires-target-validation",
    });
  }
  return {
    schemaVersion: 1,
    mechanism: "GoldHEN Application File Redirector (AFR)",
    target: { titleId: target.titleId, updateVersion: target.updateVersion, mode: target.mode },
    pluginPath: PLUGIN_PATH,
    entries,
    summary: {
      mappedFiles: entries.length,
      unmappedFiles: Math.max(0, files.length - entries.length),
      deploymentAllowed: false,
    },
    limitations: [
      "Only explicit /app0 destination mappings are accepted; PC mod paths are never guessed.",
      "The AFR plugin must be installed and enabled separately in GoldHEN.",
      "AFR redirection is a candidate deployment mechanism, not proof that a specific GTA V 1.73 file path is read or compatible.",
      "Every mapped resource still requires exact CUSA00411 / 1.73 validation before deployment.",
      "This plan does not copy files to the console or modify plugins.ini.",
    ],
  };
}
