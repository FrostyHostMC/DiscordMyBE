import { PS4_TARGET } from "./target.js";

const ROUTES = Object.freeze({
  ".rpf": { family: "archive", stage: "archive-analysis", source: "archive-parser-required", target: "archive-writer-unverified", risk: "container-only" },
  ".yft": { family: "fragment", stage: "resource-decode", source: "native-inspector-partial", target: "ps4-writer-missing", risk: "platform-layout-unverified" },
  ".ydr": { family: "drawable", stage: "resource-decode", source: "backend-required", target: "ps4-writer-missing", risk: "platform-layout-unverified" },
  ".ydd": { family: "drawable-dictionary", stage: "resource-decode", source: "backend-required", target: "ps4-writer-missing", risk: "platform-layout-unverified" },
  ".ytd": { family: "texture-dictionary", stage: "resource-decode", source: "native-inspector-partial", target: "ps4-writer-missing", risk: "texture-encoding-unverified" },
  ".ybn": { family: "collision", stage: "resource-decode", source: "backend-required", target: "ps4-writer-missing", risk: "platform-layout-unverified" },
  ".ymap": { family: "map-placement", stage: "world-resource-analysis", source: "backend-required", target: "ps4-writer-missing", risk: "world-dependency-unresolved" },
  ".ytyp": { family: "archetype", stage: "world-resource-analysis", source: "backend-required", target: "ps4-writer-missing", risk: "world-dependency-unresolved" },
  ".ymf": { family: "resource-manifest", stage: "dependency-resolution", source: "backend-required", target: "ps4-writer-missing", risk: "mount-order-unverified" },
  ".ymt": { family: "game-metadata", stage: "metadata-analysis", source: "backend-required", target: "target-schema-unverified", risk: "schema-version-unverified" },
  ".ycd": { family: "animation", stage: "animation-analysis", source: "backend-required", target: "ps4-writer-missing", risk: "animation-channel-coverage" },
  ".ypt": { family: "particle-effects", stage: "effect-analysis", source: "backend-required", target: "ps4-writer-missing", risk: "effect-runtime-unverified" },
  ".ynv": { family: "navigation-mesh", stage: "world-resource-analysis", source: "backend-read-write-candidate", target: "ps4-writer-unverified", risk: "target-cell-layout-unverified" },
  ".ynd": { family: "path-nodes", stage: "world-resource-analysis", source: "backend-read-write-candidate", target: "ps4-writer-unverified", risk: "target-node-layout-unverified" },
  ".ysc": { family: "compiled-script", stage: "runtime-analysis", source: "script-inspection-candidate", target: "native-reimplementation-required", risk: "script-runtime-and-natives" },
  ".awc": { family: "audio-container", stage: "audio-analysis", source: "backend-read-candidate", target: "ps4-writer-unverified", risk: "codec-and-bank-layout" },
  ".rel": { family: "audio-metadata", stage: "audio-analysis", source: "backend-required", target: "ps4-writer-missing", risk: "audio-schema-unverified" },
  ".gxt2": { family: "localized-text", stage: "metadata-analysis", source: "backend-required", target: "ps4-writer-missing", risk: "target-string-table-unverified" },
  ".meta": { family: "metadata", stage: "metadata-analysis", source: "xml-parser-available", target: "target-schema-unverified", risk: "metadata-reference-resolution" },
  ".xml": { family: "configuration", stage: "metadata-analysis", source: "xml-parser-available", target: "manual-schema-mapping", risk: "mod-specific-semantics" },
  ".ini": { family: "configuration", stage: "configuration-analysis", source: "text-parser-required", target: "manual-mapping", risk: "mod-specific-semantics" },
  ".json": { family: "configuration", stage: "configuration-analysis", source: "json-parser-available", target: "manual-mapping", risk: "mod-specific-semantics" },
  ".lua": { family: "script-source", stage: "runtime-analysis", source: "source-review", target: "native-reimplementation-required", risk: "runtime-api-differences" },
  ".cs": { family: "script-source", stage: "runtime-analysis", source: "source-review", target: "native-reimplementation-required", risk: "dotnet-and-runtime-api" },
  ".js": { family: "script-source", stage: "runtime-analysis", source: "source-review", target: "native-reimplementation-required", risk: "runtime-api-differences" },
  ".asi": { family: "pc-native-plugin", stage: "runtime-analysis", source: "binary-identification-only", target: "native-reimplementation-required", risk: "windows-abi-and-runtime" },
  ".dll": { family: "pc-native-plugin", stage: "runtime-analysis", source: "binary-identification-only", target: "native-reimplementation-required", risk: "windows-abi-and-runtime" },
  ".exe": { family: "pc-native-plugin", stage: "runtime-analysis", source: "binary-identification-only", target: "unsupported-as-payload", risk: "windows-executable" },
  ".prx": { family: "console-native-plugin", stage: "runtime-analysis", source: "binary-identification-only", target: "exact-title-build-validation", risk: "orbis-abi-and-title-hooks" },
  ".fbx": { family: "source-model", stage: "asset-authoring", source: "external-dcc-required", target: "rage-resource-authoring-required", risk: "skeleton-material-and-lod-mapping" },
  ".obj": { family: "source-model", stage: "asset-authoring", source: "external-dcc-required", target: "rage-resource-authoring-required", risk: "skeleton-material-and-lod-mapping" },
  ".gltf": { family: "source-model", stage: "asset-authoring", source: "external-dcc-required", target: "rage-resource-authoring-required", risk: "skeleton-material-and-lod-mapping" },
  ".glb": { family: "source-model", stage: "asset-authoring", source: "external-dcc-required", target: "rage-resource-authoring-required", risk: "skeleton-material-and-lod-mapping" },
  ".png": { family: "texture-source", stage: "texture-authoring", source: "image-decoder-available", target: "rage-texture-authoring-required", risk: "format-mip-and-compression" },
  ".dds": { family: "texture-source", stage: "texture-authoring", source: "image-decoder-required", target: "rage-texture-authoring-required", risk: "format-mip-and-compression" },
  ".wav": { family: "audio-source", stage: "audio-authoring", source: "audio-tool-required", target: "rage-audio-authoring-required", risk: "codec-sample-rate-and-bank-layout" },
  ".mp3": { family: "audio-source", stage: "audio-authoring", source: "audio-tool-required", target: "rage-audio-authoring-required", risk: "codec-sample-rate-and-bank-layout" },
});

const extOf = (file) => (file.extension || file.path?.slice(file.path.lastIndexOf(".")) || "").toLowerCase();
const baseOf = (path) => path.split("/").at(-1).toLowerCase().replace(/\.[^.]+$/, "");
const statusFor = (route) => {
  if (!route) return "manual-format-identification";
  if (route.target === "native-reimplementation-required") return "behavior-reimplementation";
  if (route.target === "unsupported-as-payload") return "unsupported";
  if (route.target.includes("unverified") || route.target.includes("missing") || route.target.includes("required")) return "blocked-pending-target-adapter";
  return "analysis-or-authoring-only";
};

function candidatePairs(files) {
  const pairs = [];
  const index = new Map();
  for (const file of files) {
    const ext = extOf(file);
    const stem = baseOf(file.path);
    const normalizedStem = stem.endsWith("_hi") ? stem.slice(0, -3) : stem;
    const key = normalizedStem;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ file, ext, stem });
  }
  for (const entries of index.values()) {
    const byExt = new Map();
    for (const entry of entries) {
      if (!byExt.has(entry.ext)) byExt.set(entry.ext, []);
      byExt.get(entry.ext).push(entry.file.path);
    }
    const supported = [".yft", ".ydr", ".ydd", ".ytd", ".ybn"];
    const present = supported.filter((ext) => byExt.has(ext));
    if (present.length < 2) continue;
    for (const ext of present) {
      for (const path of byExt.get(ext)) {
        const peers = present.filter((other) => other !== ext).flatMap((other) => byExt.get(other));
        if (peers.length) pairs.push({ path, candidates: peers, confidence: "filename-co-location-only", verifiedDependency: false });
      }
    }
  }
  return pairs;
}

export function buildUniversalPortPlan({ files = [], target = PS4_TARGET } = {}) {
  const resources = files.map((file) => {
    const extension = extOf(file);
    const route = ROUTES[extension] || null;
    return {
      path: file.path,
      extension,
      family: route?.family || "unknown",
      stage: route?.stage || "manual-review",
      sourceCapability: route?.source || "unknown",
      targetCapability: route?.target || "unknown",
      status: statusFor(route),
      blocker: route?.risk || "format-and-purpose-not-identified",
      bytes: file.size ?? file.bytes?.byteLength ?? 0,
    };
  });
  const counts = resources.reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, {});
  const stages = [...new Set(resources.map((item) => item.stage))];
  const blockers = resources.filter((item) => item.status !== "analysis-or-authoring-only");
  return {
    schemaVersion: 1,
    mode: "plan-only",
    target: { titleId: target.titleId, updateVersion: target.updateVersion, mode: target.mode },
    resources,
    candidateRelationships: candidatePairs(files),
    pipeline: stages.map((stage) => ({
      stage,
      files: resources.filter((item) => item.stage === stage).map((item) => item.path),
      state: "planned-not-executed",
    })),
    summary: {
      fileCount: resources.length,
      familyCount: new Set(resources.map((item) => item.family)).size,
      statusCounts: counts,
      blockedCount: blockers.length,
      conversionOutputsWritten: 0,
      installable: false,
    },
    limitations: [
      "This plan does not rewrite or package any resource.",
      "Filename co-location is a candidate relationship, not proof of a game dependency.",
      "PC Legacy/Enhanced writer support is not PS4 writer support.",
      "Exact CUSA00411 / GTA V 1.73 resources and executable compatibility remain unverified.",
      "PC ASI/DLL and runtime-dependent scripts need separate PS4-native behavior implementations.",
    ],
  };
}
