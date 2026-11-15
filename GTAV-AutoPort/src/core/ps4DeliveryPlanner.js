const PC_NATIVE_EXTENSIONS = new Set([".asi", ".dll", ".exe", ".sys"]);
const PS4_NATIVE_EXTENSIONS = new Set([".prx", ".sprx"]);
const RAGE_RESOURCE_EXTENSIONS = new Set([
  ".yft", ".ydr", ".ydd", ".ytd", ".ybn", ".ymap", ".ytyp", ".ymf",
  ".ymt", ".ycd", ".ypt", ".ynd", ".ynv", ".awc", ".rel", ".gxt2", ".ysc"
]);
const METADATA_EXTENSIONS = new Set([".meta", ".xml", ".ini", ".cfg", ".json", ".txt", ".lua", ".cs", ".js", ".py"]);
const SOURCE_ASSET_EXTENSIONS = new Set([".fbx", ".obj", ".dae", ".gltf", ".glb", ".blend", ".png", ".jpg", ".jpeg", ".dds", ".tga", ".bmp", ".wav", ".mp3", ".ogg", ".flac"]);

function extension(path) {
  const name = String(path || "").split(/[\\/]/).at(-1) || "";
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

function routeFor(path, conversion, archive) {
  const ext = extension(path);
  if (PC_NATIVE_EXTENSIONS.has(ext)) {
    return {
      route: "preserve-pc-runtime-only",
      status: "blocked",
      reason: "Windows/PC native code cannot be installed as a working PS4 plugin. A PS4-native implementation or replacement is required.",
      requirements: ["Identify the plugin's behavior and dependencies", "Implement or obtain a compatible Orbis-native PRX for the exact target build"]
    };
  }
  if (PS4_NATIVE_EXTENSIONS.has(ext)) {
    return {
      route: "validate-orbis-plugin",
      status: "target-validation-required",
      reason: "A PRX/SPRX extension does not prove that the binary targets Orbis, CUSA00419, or GTA V 1.73.",
      requirements: ["Verify ELF/PRX platform and architecture", "Verify GoldHEN loader compatibility", "Validate title ID, update build and plugin offsets"]
    };
  }
  if (ext === ".rpf") {
    const inspected = archive || null;
    if (inspected?.status === "extracted-raw-open-archive") {
      return {
        route: "inspect-contents-then-package",
        status: "source-inspected",
        reason: "The supported PC RPF7 OPEN archive was extracted as raw source files. Its payloads still need target-loader compatibility checks and the archive itself has not been converted to Orbis.",
        requirements: ["Classify every contained resource", "Resolve dependencies", "Use a verified Orbis packaging backend only after its runtime is integrated"]
      };
    }
    return {
      route: "preserve-and-identify-archive",
      status: "unsupported-or-unverified",
      reason: inspected?.error || "Archive format and encryption have not been validated by a supported reader.",
      requirements: ["Identify archive variant and encryption", "Preserve original bytes", "Do not rewrite unknown Orbis/RPF headers"]
    };
  }
  if (RAGE_RESOURCE_EXTENSIONS.has(ext)) {
    return {
      route: "resource-loader-compatibility",
      status: conversion?.status === "pc-legacy-candidate" ? "pc-candidate-only" : "unconverted",
      reason: conversion?.status === "pc-legacy-candidate"
        ? "A PC Legacy round-trip candidate exists, but that proves neither Orbis encoding nor PS4 loader acceptance."
        : "This RAGE resource needs format-specific parsing and a verified PS4 loading or conversion path. Extension recognition alone is not conversion.",
      requirements: ["Inspect resource structure and platform/version evidence", "Resolve referenced resources", "Confirm the selected PS4 loader supports this exact resource type"]
    };
  }
  if (METADATA_EXTENSIONS.has(ext)) {
    return {
      route: "metadata-translation-review",
      status: "review-required",
      reason: "Metadata may be XML, binary META, PSO, RBF or script/configuration data. Renaming extensions does not translate their internal representation.",
      requirements: ["Parse using the correct metadata format", "Map supported fields without dropping unknown fields", "Validate game-build-specific names and references"]
    };
  }
  if (SOURCE_ASSET_EXTENSIONS.has(ext)) {
    return {
      route: "source-asset-conversion",
      status: "converter-required",
      reason: "Source models, images and audio need game-compatible export, compression, mipmaps, skeleton/material mapping or audio conversion as applicable.",
      requirements: ["Identify source encoding and dimensions", "Convert with a format-specific adapter", "Validate the generated RAGE resource on the target loader"]
    };
  }
  return {
    route: "preserve-and-review",
    status: "unknown",
    reason: "No verified PS4 conversion route is registered for this file. It remains preserved as source.",
    requirements: ["Inspect content and dependencies", "Add a tested format adapter before conversion"]
  };
}

/**
 * Creates a conservative per-file PS4 delivery strategy. This is a planning
 * report only: it does not execute third-party recipes, rename resources,
 * write Orbis archives, or claim PS4 installability.
 */
export function buildPs4DeliveryPlan({ files = [], conversions = [], archiveInspections = [], target = {} } = {}) {
  if (!Array.isArray(files)) throw new Error("files must be an array.");
  const conversionByPath = new Map(conversions.filter((item) => item?.sourcePath).map((item) => [item.sourcePath.toLowerCase(), item]));
  const archiveByPath = new Map(archiveInspections.filter((item) => item?.sourcePath).map((item) => [item.sourcePath.toLowerCase(), item]));
  const items = files.filter((file) => typeof file?.path === "string").map((file) => {
    const path = file.path;
    const conversion = conversionByPath.get(path.toLowerCase()) || null;
    const archive = archiveByPath.get(path.toLowerCase()) || null;
    return {
      path,
      bytes: Number.isFinite(file.bytes?.byteLength) ? file.bytes.byteLength : Number(file.size) || 0,
      sourceArchive: file.sourceArchive || null,
      ...routeFor(path, conversion, archive)
    };
  });
  const counts = {};
  for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
  const targetId = String(target?.titleId || target?.cusa || "").toUpperCase();
  const update = String(target?.updateVersion || target?.gameUpdate || "");
  const exactTargetSpecified = targetId === "CUSA00419" && update === "1.73";
  return {
    schemaVersion: 1,
    status: "strategy-only",
    target: {
      titleId: targetId || null,
      updateVersion: update || null,
      exactRequestedTarget: exactTargetSpecified,
      compatibilityVerified: false
    },
    packaging: {
      orbisRpfBackend: "not-integrated",
      projectVLoader: "not-configured",
      goldhenPluginDeployment: "planning-only",
      note: "No Orbis builder or PS4 plugin is executed by this planner. Backend integration and target-build tests are still required."
    },
    summary: {
      fileCount: items.length,
      byStatus: counts,
      ps4ReadyFiles: 0,
      installable: false
    },
    items,
    blockers: [
      "No validated Orbis RPF writer is currently invoked by the automatic preparation pipeline.",
      "Project V support is not assumed: loader version, accepted resource types and loading paths must be verified against a known-good PS4 test.",
      "CUSA00419 / GTA V 1.73 compatibility has not been established by an on-console test.",
      "PC Legacy round-trip verification is not PS4 resource validation."
    ],
    limitations: [
      "This plan is advisory and preserves unknown files; it does not rename YMT to OMT or make other extension-only changes.",
      "No native plugin is built, installed or executed.",
      "No source mod instructions or scripts are executed."
    ]
  };
}
