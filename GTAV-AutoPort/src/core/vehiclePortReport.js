import { XMLParser, XMLValidator } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, trimValues: true, isArray: (name) => name === "Item" });
const text = (value) => value == null ? "" : typeof value === "object" && "#text" in value ? String(value["#text"]).trim() : String(value).trim();
const asArray = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const base = (path) => String(path).replaceAll("\\", "/").split("/").pop().toLowerCase();
const stem = (path) => base(path).replace(/\.[^.]+$/, "");
function parseMeta(file, label) {
  if (!file) return { parsed: null, error: null };
  const xml = new TextDecoder().decode(file.bytes);
  const valid = XMLValidator.validate(xml);
  if (valid !== true) return { parsed: null, error: `${label}: ${valid.err?.msg || "invalid XML"}` };
  try { return { parsed: parser.parse(xml), error: null }; } catch (error) { return { parsed: null, error: `${label}: ${error.message}` }; }
}
function walk(value, visit, parents = []) {
  if (Array.isArray(value)) { value.forEach((item) => walk(item, visit, parents)); return; }
  if (!value || typeof value !== "object") return;
  visit(value, parents);
  for (const [key, child] of Object.entries(value)) if (child && typeof child === "object") walk(child, visit, [...parents, key]);
}
function records(parsed, predicate) {
  const found = [];
  walk(parsed, (node, parents) => { if (predicate(node)) found.push({ node, parents }); });
  return found;
}
function findValue(node, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const key = Object.keys(node || {}).find((candidate) => wanted.has(candidate.toLowerCase()));
  return key ? text(node[key]) : "";
}
function matchFiles(files, name, extensions) {
  if (!name) return [];
  const wanted = name.toLowerCase();
  return files.filter((file) => stem(file.path) === wanted && extensions.includes(file.path.slice(file.path.lastIndexOf(".")).toLowerCase()));
}
function modelEntries(parsed) {
  return records(parsed, (node) => !!findValue(node, ["modelName"]) && !!findValue(node, ["handlingId"]));
}
function handlingEntries(parsed) {
  return records(parsed, (node) => !!findValue(node, ["handlingName"]));
}
function modelVariationEntries(parsed, modelName) {
  return records(parsed, (node) => findValue(node, ["modelName"]).toLowerCase() === modelName.toLowerCase());
}
function referenceValues(node, pattern) {
  const values = [];
  walk(node, (entry) => {
    for (const [key, value] of Object.entries(entry)) if (pattern.test(key) && typeof value !== "object" && text(value)) values.push({ field: key, value: text(value) });
  });
  return values;
}

/**
 * Resolves a single add-on/replacement vehicle across its metadata and asset inventory.
 * It does not assume PC Legacy output is PS4-compatible.
 */
export function buildVehiclePortReport({ files, modelName }) {
  if (!Array.isArray(files) || !files.length) throw new Error("Imported vehicle files are required.");
  const target = String(modelName || "").trim().toLowerCase();
  if (!target) throw new Error("A vehicle model name is required.");
  const byName = new Map(files.map((file) => [base(file.path), file]));
  const read = (name) => parseMeta(byName.get(name), name);
  const vehicles = read("vehicles.meta");
  const handling = read("handling.meta");
  const variations = read("carvariations.meta");
  const carcols = read("carcols.meta");
  const layouts = read("vehiclelayouts.meta");
  const errors = [vehicles.error, handling.error, variations.error, carcols.error, layouts.error].filter(Boolean);
  if (!vehicles.parsed) throw new Error(errors.join("; ") || "vehicles.meta is missing or invalid.");
  if (!handling.parsed) throw new Error(errors.join("; ") || "handling.meta is missing or invalid.");
  const vehicleMatches = modelEntries(vehicles.parsed).filter(({ node }) => findValue(node, ["modelName"]).toLowerCase() === target);
  if (vehicleMatches.length !== 1) throw new Error(`Expected exactly one vehicles.meta entry for "${target}", found ${vehicleMatches.length}.`);
  const vehicle = vehicleMatches[0].node;
  const handlingId = findValue(vehicle, ["handlingId"]);
  const handlingMatches = handlingEntries(handling.parsed).filter(({ node }) => findValue(node, ["handlingName"]).toLowerCase() === handlingId.toLowerCase());
  if (handlingMatches.length !== 1) throw new Error(`Expected exactly one handling.meta entry for "${handlingId}", found ${handlingMatches.length}.`);
  const txdName = findValue(vehicle, ["txdName"]);
  const audioName = findValue(vehicle, ["audioNameHash"]);
  const variationMatches = variations.parsed ? modelVariationEntries(variations.parsed, target) : [];
  const layoutName = findValue(vehicle, ["layout"]);
  const modelAssets = {
    mainFragment: matchFiles(files, target, [".yft"]),
    highFragment: matchFiles(files, `${target}_hi`, [".yft"]),
    textureDictionary: matchFiles(files, txdName, [".ytd"]),
  };
  const unresolved = [];
  const requiredMissing = [];
  if (!modelAssets.mainFragment.length) requiredMissing.push(`${target}.yft`);
  if (!modelAssets.textureDictionary.length) requiredMissing.push(`${txdName || target}.ytd`);
  if (modelAssets.mainFragment.length > 1 || modelAssets.textureDictionary.length > 1) unresolved.push("Duplicate model or texture filenames make asset selection ambiguous.");
  if (!modelAssets.highFragment.length) unresolved.push("High-detail fragment is absent; verify whether the source mod intentionally omits it.");
  if (!variationMatches.length) unresolved.push("No matching carvariations.meta entry was found; stock/default variation behavior is not inferred.");
  if (errors.length) unresolved.push(...errors);
  const variationKitRefs = variationMatches.flatMap(({ node }) => referenceValues(node, /kit|siren/i));
  const carcolsPresent = !!carcols.parsed;
  const audioFiles = audioName ? files.filter((file) => /\.(awc|rel|dat151|dat54|dat10)$/i.test(file.path) && file.path.toLowerCase().includes(audioName.toLowerCase())) : [];
  const cameraName = findValue(vehicle, ["cameraName", "cameraHash", "firstPersonDrivebyData"]);
  const layoutMatches = layoutName && layouts.parsed ? records(layouts.parsed, (node) => Object.values(node).some((value) => text(value).toLowerCase() === layoutName.toLowerCase())) : [];
  return {
    schemaVersion: 1,
    format: "autoport-vehicle-port-report",
    target: { titleId: "CUSA00419", update: "1.73", edition: "PS4" },
    modelName: target,
    metadata: { vehicle, handling: handlingMatches[0].node, variations: variationMatches.map(({ node }) => node), carcols: carcols.parsed, vehicleLayouts: layouts.parsed },
    references: {
      handling: { value: handlingId, resolved: true },
      textureDictionary: { value: txdName, resolved: modelAssets.textureDictionary.length === 1 },
      audio: { value: audioName || null, matchingFiles: audioFiles.map((file) => file.path), resolution: audioFiles.length ? "candidate-file-match" : audioName ? "not-found-in-imported-files" : "not-declared" },
      camera: { value: cameraName || null, resolution: cameraName ? "game-native-reference-unresolved" : "not-declared" },
      vehicleLayout: { value: layoutName || null, matchingEntries: layoutMatches.length, resolution: layoutName ? layoutMatches.length ? "candidate-entry-match" : "not-found-or-schema-different" : "not-declared" },
      variationKitReferences: variationKitRefs,
      carcols: { present: carcolsPresent, resolution: carcolsPresent ? "source-document-retained-kit-schema-not-yet-typed" : "not-provided" },
    },
    assets: Object.fromEntries(Object.entries(modelAssets).map(([key, matches]) => [key, matches.map((file) => ({ path: file.path, bytes: file.bytes?.byteLength ?? file.size ?? 0 }))])),
    validation: { validMetadataLinks: true, requiredMissing, unresolved, readyForResourceConversion: requiredMissing.length === 0 && unresolved.length === 0 },
    sourceFiles: files.map((file) => file.path),
    limitations: ["PC Legacy RAGE resources are not automatically PS4-compatible.", "Camera and audio identifiers require resolution against the target game's own data.", "Vehicle variations, mod kits, layouts and tuning assets must be resolved before declaring a complete vehicle port."],
  };
}
