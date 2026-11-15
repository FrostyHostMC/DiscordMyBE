import { PS4_TARGET } from "./target.js";

const ROUTES = Object.freeze({
  ".rpf": { family: "archive", stage: "archive-analysis", source: "ragekit-rpf-reader", target: "ps4-archive-layout-unverified", risk: "encryption-keys-and-target-container-layout" },
  ".fx": { family: "reshade-shader", stage: "shader-source-analysis", source: "reshade-static-analyzer", target: "ps4-native-renderer-adaptation-required", risk: "PC-ReShade-runtime-and-renderer-data-are-not-available-on-PS4" },
  ".fxh": { family: "reshade-shader-include", stage: "shader-dependency-analysis", source: "reshade-static-analyzer", target: "dependency-resolution-and-PS4-translation-required", risk: "HLSL-include-and-runtime-semantics" },
  ".hlsl": { family: "shader-source", stage: "shader-source-analysis", source: "static-hlsl-inspection", target: "ps4-native-renderer-adaptation-required", risk: "shader-model-and-renderer-interface-mismatch" },
  ".gfx": { family: "scaleform-gfx", stage: "scaleform-analysis", source: "scaleform-header-inspector", target: "ps4-gfx-loader-build-unverified", risk: "GTA-1.46-loader-does-not-prove-1.73-hook-compatibility" },
  ".swf": { family: "scaleform-swf", stage: "scaleform-authoring", source: "scaleform-header-inspector", target: "gfXexport-and-runtime-validation-required", risk: "SWF-needs-GFx-export-and-PS4-runtime-validation" },
  ".fla": { family: "scaleform-source", stage: "scaleform-authoring", source: "external-authoring-project", target: "scaleform-export-required", risk: "ActionScript-version-and-GFx-export-settings" },
  ".as": { family: "scaleform-source", stage: "scaleform-authoring", source: "actionscript-source-review", target: "scaleform-compile-and-runtime-validation-required", risk: "ActionScript-2-and-GTA-Scaleform-API-compatibility" },
  ".ttf": { family: "font-source", stage: "scaleform-authoring", source: "font-file-intake", target: "scaleform-font-export-required", risk: "GFx-font-linkage-and-export-pipeline" },
  ".otf": { family: "font-source", stage: "scaleform-authoring", source: "font-file-intake", target: "scaleform-font-export-required", risk: "GFx-font-linkage-and-export-pipeline" },
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
  ".txt": { family: "documentation", stage: "documentation-review", source: "text-readable", target: "manual-install-instruction-review", risk: "PC-install-paths-may-not-match-PS4" },
  ".md": { family: "documentation", stage: "documentation-review", source: "text-readable", target: "manual-install-instruction-review", risk: "PC-install-paths-may-not-match-PS4" },
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

const OUTPUT_CONTRACTS = Object.freeze({
  fragment: { artifacts: ["model.yft", "model_hi.yft (when the source has a high-detail LOD)", "model.ytd", "model.ybn (when collision is separate)"], inputs: ["complete mesh/material data", "skeleton and bone mapping", "LOD definitions", "collision and texture dependencies", "vehicle or ped metadata when applicable"], gate: "PS4 RAGE fragment writer, PS4 texture dictionary writer, dependency resolution and CUSA00419 / 1.73 validation" },
  drawable: { artifacts: ["model.ydr or model.ydd", "model.ytd", "referenced materials and shaders"], inputs: ["mesh and material source", "texture images", "material/shader mapping"], gate: "PS4 drawable and texture dictionary writers plus target-build validation" },
  "texture-dictionary": { artifacts: ["model.ytd"], inputs: ["source images or DDS", "texture names and hashes", "mip chain", "target compression/format"], gate: "PS4 YTD writer with verified texture formats, mipmaps and platform encoding" },
  "texture-source": { artifacts: ["model.ytd"], inputs: ["decoded image", "texture name/hash", "mipmap policy", "material usage"], gate: "PS4 YTD writer; PNG/DDS alone is not a game-ready GTA texture" },
  collision: { artifacts: ["model.ybn"], inputs: ["collision mesh", "materials", "bounds and physics properties"], gate: "PS4 YBN writer and in-game collision validation" },
  "map-placement": { artifacts: ["map.ymap", "referenced .ytyp", "all referenced .ydr/.ydd/.ybn/.ytd resources"], inputs: ["world transforms", "archetype references", "entity sets", "streaming bounds"], gate: "PS4 map/archetype writers and complete world dependency validation" },
  archetype: { artifacts: ["asset.ytyp", "referenced drawable/fragment/collision/texture resources"], inputs: ["archetype definitions", "asset bounds", "LOD and physics references"], gate: "PS4 YTYP writer and reference validation" },
  "source-model": { artifacts: ["model.yft or model.ydr/.ydd", "model.ytd", "model.ybn when needed"], inputs: ["mesh", "UVs", "materials", "skeleton for skinned models", "LODs", "collision"], gate: "RAGE authoring/export pipeline with PS4 resource encoding" },
  "pc-native-plugin": { artifacts: ["No direct PS4 binary output; behavior must be reimplemented as a separate Orbis PRX only if feasible"], inputs: ["documented behavior", "native API calls", "runtime dependencies"], gate: "Native Orbis PRX reimplementation, exact-title hooks and independent binary validation" },
  "script-source": { artifacts: ["No direct PS4 script output; native behavior implementation or compatible game script required"], inputs: ["source code", "runtime/API dependencies", "game-native calls"], gate: "Behavior translation and compatible PS4 runtime" },
  "console-native-plugin": { artifacts: ["plugin SPRX/PRX", "matching plugins.ini entry", "configuration files required by that plugin"], inputs: ["Orbis ABI binary", "exact title/update support", "plugin-specific config schema"], gate: "Binary signature/ABI, GoldHEN loader, title ID and exact game update validation" },
  archive: { artifacts: ["target-compatible RPF archive", "complete internal resource tree", "verified AFR /app0 mapping when using AFR"], inputs: ["target-platform resources", "archive encryption/container metadata", "mount/load order"], gate: "PS4 RPF writer or verified PS4 archive plus exact-build container path" },
  "audio-source": { artifacts: ["target-compatible .awc bank", "matching .rel metadata where required"], inputs: ["decoded audio", "codec/sample rate", "bank and event mapping"], gate: "PS4 audio bank writer and in-game event validation" },
});

function outputContractFor(route) {
  if (!route) return { artifacts: ["No output is generated until the file format and purpose are identified"], inputs: ["file content and dependency context"], gate: "Format-specific adapter and target compatibility validation" };
  return OUTPUT_CONTRACTS[route.family] || { artifacts: [route.family + " target resource or metadata output"], inputs: ["source data and dependencies"], gate: route.target };
}

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
      outputContract: outputContractFor(route),
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
      "Exact CUSA00419 / GTA V 1.73 resources and executable compatibility remain unverified.",
      "PC ASI/DLL and runtime-dependent scripts need separate PS4-native behavior implementations.",
    ],
  };
}
