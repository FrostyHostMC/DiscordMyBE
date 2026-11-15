import { XMLParser, XMLValidator } from "fast-xml-parser";

const MODEL_EXTENSIONS = new Set([".yft", ".ydr", ".ydd"]);
const TEXTURE_EXTENSIONS = new Set([".ytd"]);
const WORLD_EXTENSIONS = new Set([".ybn", ".ymap", ".ytyp", ".ymf", ".ycd", ".ypt", ".ymt"]);
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, trimValues: true, isArray: (name) => /^(Item|Placement|Entity|Ped|Object|Entry)$/i.test(name) });
const basename = (path) => path.replaceAll("\\", "/").split("/").at(-1);
const extension = (path) => { const name = basename(path); const index = name.lastIndexOf("."); return index < 0 ? "" : name.slice(index).toLowerCase(); };
const stem = (path) => basename(path).replace(/\.[^.]+$/, "").toLowerCase();
const decode = (file) => new TextDecoder("utf-8", { fatal: false }).decode(file.bytes || new Uint8Array());
const asArray = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const text = (value) => typeof value === "string" || typeof value === "number" ? String(value).trim() : value && typeof value === "object" && "#text" in value ? String(value["#text"]).trim() : "";
function walk(value, visitor) { if (Array.isArray(value)) value.forEach((item) => walk(item, visitor)); else if (value && typeof value === "object") { visitor(value); Object.values(value).forEach((child) => walk(child, visitor)); } }
function get(object, names) { const wanted = new Set(names.map((name) => name.toLowerCase())); const key = Object.keys(object || {}).find((item) => wanted.has(item.toLowerCase())); return key ? object[key] : undefined; }
function vector(value) { if (!value || typeof value !== "object") return null; const raw = ["X", "Y", "Z"].map((axis) => text(get(value, [axis]))); if (raw.some((item) => !item)) return null; const [x, y, z] = raw.map(Number); return [x, y, z].every(Number.isFinite) ? { x, y, z } : null; }
function collectPedEntries(parsed) {
  const found = [];
  walk(parsed, (node) => {
    const modelName = text(get(node, ["modelName", "Name", "name"]));
    const txdName = text(get(node, ["txdName", "TextureDictionary", "txd"]));
    const pedType = text(get(node, ["Pedtype", "pedType", "Type"]));
    if (modelName && (txdName || pedType || get(node, ["ClipDictionaryName", "MovementClipSet", "ExpressionSetName", "AudioNameHash"]))) found.push({ modelName, txdName: txdName || null, pedType: pedType || null, raw: node });
  });
  const seen = new Set();
  return found.filter((entry) => { const key = entry.modelName.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}
function inspectSpawnConfig(file) {
  const source = decode(file); const ext = extension(file.path);
  if (ext === ".json") { try { const parsed = JSON.parse(source); return { path: file.path, valid: true, format: "json", parsed, summary: summarizeConfig(parsed) }; } catch (error) { return { path: file.path, valid: false, format: "json", error: error.message, summary: {} }; } }
  if (ext === ".xml") { const validation = XMLValidator.validate(source); if (validation !== true) return { path: file.path, valid: false, format: "xml", error: validation.err?.msg || "Invalid XML", summary: {} }; const parsed = parser.parse(source); return { path: file.path, valid: true, format: "xml", parsed, summary: summarizeConfig(parsed) }; }
  if (ext === ".ini") { const keys = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith(";") && !line.startsWith("#") && line.includes("=")).map((line) => line.slice(0, line.indexOf("=")).trim()); return { path: file.path, valid: true, format: "ini", summary: { settingCount: keys.length, spawnSettings: keys.filter((key) => /(spawn|model|ped|object|coord|position|rotation|heading|count|amount|scenario)/i.test(key)) } }; }
  return { path: file.path, valid: false, format: ext.slice(1), error: "Unsupported spawn configuration format", summary: {} };
}
function summarizeConfig(parsed) {
  const signals = { modelReferences: 0, positionVectors: 0, rotationVectors: 0, headingFields: 0, pedFields: 0, objectFields: 0, spawnCountFields: 0, scenarioFields: 0, archetypeFields: 0 };
  walk(parsed, (node) => {
    for (const key of Object.keys(node)) {
      if (/^(modelName|modelHash|model|hashName)$/i.test(key)) signals.modelReferences++;
      if (/^(position|coordinates|coords)$/i.test(key) && vector(node[key])) signals.positionVectors++;
      if (/^(rotation|orientation)$/i.test(key) && vector(node[key])) signals.rotationVectors++;
      if (/^(heading|yaw)$/i.test(key)) signals.headingFields++;
      if (/ped/i.test(key)) signals.pedFields++;
      if (/object|prop/i.test(key)) signals.objectFields++;
      if (/^(count|amount|number|probability|density)$/i.test(key)) signals.spawnCountFields++;
      if (/scenario/i.test(key)) signals.scenarioFields++;
      if (/archetype/i.test(key)) signals.archetypeFields++;
    }
  });
  return signals;
}

/** Inventory and map ped/object assets without assuming that filename peers are real dependencies. */
export function inspectPedObjectPacks(files = []) {
  const pedMetadataFiles = files.filter((file) => /^(peds|pedalternatevariations|pedcomponentvariations|pedprops|pedpersonality|pedgroup)\.meta$/i.test(basename(file.path)));
  const pedEntries = []; const pedMetadataReports = [];
  for (const file of pedMetadataFiles) {
    const source = decode(file); const validation = XMLValidator.validate(source);
    if (validation !== true) { pedMetadataReports.push({ path: file.path, valid: false, error: validation.err?.msg || "Invalid XML" }); continue; }
    const parsed = parser.parse(source); const entries = collectPedEntries(parsed);
    pedEntries.push(...entries.map((entry) => ({ ...entry, sourcePath: file.path })));
    pedMetadataReports.push({ path: file.path, valid: true, entryCount: entries.length, rootElements: Object.keys(parsed) });
  }
  const spawnConfigFiles = files.filter((file) => [".xml", ".json", ".ini"].includes(extension(file.path)) && !pedMetadataFiles.includes(file));
  const spawnConfigs = spawnConfigFiles.map(inspectSpawnConfig);
  const resources = files.filter((file) => MODEL_EXTENSIONS.has(extension(file.path)) || TEXTURE_EXTENSIONS.has(extension(file.path)) || WORLD_EXTENSIONS.has(extension(file.path))).map((file) => ({ path: file.path, name: basename(file.path), stem: stem(file.path), extension: extension(file.path), bytes: file.size ?? file.bytes?.byteLength ?? 0, resourceKind: MODEL_EXTENSIONS.has(extension(file.path)) ? "model-or-fragment" : TEXTURE_EXTENSIONS.has(extension(file.path)) ? "texture-dictionary" : "world-or-behavior-dependency" }));
  const peds = pedEntries.map((entry) => {
    const modelStem = entry.modelName.toLowerCase();
    const matches = resources.filter((resource) => resource.stem === modelStem);
    const txd = entry.txdName?.toLowerCase();
    const textureMatches = txd ? resources.filter((resource) => resource.stem === txd && resource.extension === ".ytd") : [];
    return { modelName: entry.modelName, txdName: entry.txdName, pedType: entry.pedType, metadataPath: entry.sourcePath, modelCandidates: matches, textureCandidates: textureMatches, rawMetadata: entry.raw, dependencyStatus: { model: matches.length === 1 ? "candidate-resolved-by-name-only" : matches.length ? "ambiguous" : "missing", texture: !txd ? "not-declared" : textureMatches.length === 1 ? "candidate-resolved-by-name-only" : textureMatches.length ? "ambiguous" : "missing" } };
  });
  const unboundResources = resources.filter((resource) => !peds.some((ped) => ped.modelCandidates.some((candidate) => candidate.path === resource.path)) && !peds.some((ped) => ped.textureCandidates.some((candidate) => candidate.path === resource.path)));
  const objectCandidates = unboundResources.filter((resource) => resource.resourceKind === "model-or-fragment" || resource.resourceKind === "texture-dictionary" || [".ybn", ".ymap", ".ytyp"].includes(resource.extension)).map((resource) => ({ ...resource, relatedSameStem: resources.filter((peer) => peer.stem === resource.stem && peer.path !== resource.path).map((peer) => peer.path), dependencyConfidence: "filename-and-pack-co-location-only" }));
  const configSignals = spawnConfigs.filter((config) => config.valid).map((config) => ({ path: config.path, format: config.format, signals: config.summary }));
  return { schemaVersion: 1, kind: "ped-object-pack-analysis", pedMetadataReports, peds, objectCandidates, resources, spawnConfigs, configSignals, summary: { resourceFiles: resources.length, pedMetadataFiles: pedMetadataFiles.length, pedEntries: peds.length, objectAssetCandidates: objectCandidates.length, spawnConfigFiles: spawnConfigs.length, validSpawnConfigs: spawnConfigs.filter((config) => config.valid).length, missingPedModels: peds.filter((ped) => ped.dependencyStatus.model === "missing").length, ambiguousPedModels: peds.filter((ped) => ped.dependencyStatus.model === "ambiguous").length }, target: { titleId: "CUSA00419", updateVersion: "1.73", compatibility: "unverified" }, limitations: ["Filename matches are candidates, not proof of resource references.", "YMAP/YTYP/YBN and binary ped metadata require resource-level parsing and reference resolution.", "Spawn configuration fields do not implement spawn behavior; a verified menu/native runtime adapter is required.", "PS4 resource writers and exact-build in-game validation remain separate gates."] };
}

export function buildPedObjectPackExport(report) {
  if (report?.kind !== "ped-object-pack-analysis") throw new Error("A ped/object pack analysis report is required.");
  return { schemaVersion: 1, format: "autoport-ped-object-pack", target: report.target, peds: report.peds, objectCandidates: report.objectCandidates, spawnConfigs: report.spawnConfigs, requirements: ["model and texture resource conversion", "ped metadata mapping", "object archetype and collision mapping", "spawn configuration adapter", "dependency resolution and exact target validation"], compatibility: "analysis-only-unverified" };
}
