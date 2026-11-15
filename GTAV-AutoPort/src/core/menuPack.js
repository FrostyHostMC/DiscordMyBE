import { XMLParser, XMLValidator } from "fast-xml-parser";

function textOf(file) {
  return new TextDecoder("utf-8", { fatal: false }).decode(file.bytes || new Uint8Array());
}

function walk(value, pattern, found = []) {
  if (Array.isArray(value)) value.forEach((item) => walk(item, pattern, found));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (pattern.test(key)) found.push({ key, value: child });
      walk(child, pattern, found);
    }
  }
  return found;
}

function parsePluginIni(text) {
  const entries = [];
  let titleId = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const section = line.match(/^\[([A-Z0-9]{9})\]$/i);
    if (section) { titleId = section[1].toUpperCase(); continue; }
    if (titleId && line.startsWith("/data/GoldHEN/plugins/")) {
      entries.push({ titleId, path: line, extension: line.split(".").at(-1).toLowerCase() });
    }
  }
  return entries;
}

export function inspectSynapseMenuPack(files = [], targetTitleId = "CUSA00419") {
  const menuFiles = files.filter((file) => file.path.replaceAll("\\", "/").toLowerCase().includes("synapse/files/"));
  if (!menuFiles.length) return null;
  const catalogs = [];
  const warnings = [];
  for (const file of menuFiles.filter((item) => /\.json$/i.test(item.path))) {
    try {
      const value = JSON.parse(textOf(file));
      const categoryCount = Array.isArray(value) ? 1 : Object.keys(value || {}).length;
      const itemCount = Array.isArray(value) ? value.length : Object.values(value || {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
      catalogs.push({ path: file.path, categoryCount, itemCount, validJson: true });
    } catch (error) {
      catalogs.push({ path: file.path, categoryCount: 0, itemCount: 0, validJson: false, error: error.message });
      warnings.push(file.path + " is invalid JSON.");
    }
  }
  const pluginFile = files.find((file) => /(^|\/)plugins\.ini$/i.test(file.path));
  const plugins = pluginFile ? parsePluginIni(textOf(pluginFile)) : [];
  const targetPlugins = plugins.filter((item) => item.titleId === targetTitleId);
  const sprx = files.find((file) => /(^|\/)synapse\.sprx$/i.test(file.path));
  const xmlFiles = menuFiles.filter((file) => /\.xml$/i.test(file.path));
  if (!pluginFile) warnings.push("No plugins.ini was included.");
  if (!targetPlugins.length) warnings.push("No GoldHEN plugin entry was found for " + targetTitleId + ".");
  if (!sprx) warnings.push("Synapse SPRX binary was not included.");
  if (!xmlFiles.length) warnings.push("The supplied Synapse XML directory contains no XML examples, so its XML schema is unknown.");
  else warnings.push("XML files were found, but Synapse XML loader support still requires source or runtime confirmation.");
  return {
    format: "synapse-menu-data", targetTitleId, catalogs, plugins, targetPlugins,
    hasSynapseBinary: Boolean(sprx), synapseBinaryPath: sprx?.path || null,
    xmlFiles: xmlFiles.map((item) => item.path),
    summary: {
      catalogFiles: catalogs.length,
      validCatalogs: catalogs.filter((item) => item.validJson).length,
      catalogItems: catalogs.reduce((sum, item) => sum + item.itemCount, 0),
      targetPluginEntries: targetPlugins.length,
      xmlFiles: xmlFiles.length,
    },
    warnings,
    compatibility: "inventory-only-unverified",
    note: "GoldHEN plugin configuration is recognized; SPRX ABI, menu hooks, XML support and game-update compatibility are not validated.",
  };
}

export function inspectVehicleXmlPreset(file) {
  const xml = textOf(file);
  const validation = XMLValidator.validate(xml);
  if (validation !== true) return { path: file.path, validXml: false, error: validation.err?.msg || "Invalid XML", format: "unknown-vehicle-xml" };
  const parsed = new XMLParser({
    ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, trimValues: true,
    isArray: (name) => /^(Attachment|SpoonerEntity|TaskSequence|VehicleMod)$/i.test(name),
  }).parse(xml);
  const rootName = Object.keys(parsed || {})[0] || "unknown";
  const root = parsed?.[rootName] || {};
  const modelHash = walk(root, /^ModelHash$/i).map((item) => item.value).find(Boolean) || "";
  const attachments = walk(root, /attachment/i).length;
  const taskSequences = walk(root, /tasksequence/i).length;
  const menyoo = /menyoo_ver|SpoonerAttachments|SpoonerEntity/i.test(xml);
  return {
    path: file.path, validXml: true,
    format: menyoo ? "menyoo-spooner-vehicle-xml" : "generic-vehicle-xml",
    rootName, modelHash: String(modelHash), attachmentNodes: attachments, taskSequenceNodes: taskSequences,
    compatibility: "source-parsed-target-schema-unverified",
    note: menyoo
      ? "Menyoo/Spooner source XML parsed; the supplied Synapse files do not establish direct support for this format."
      : "Vehicle XML parsed, but the target menu schema is unidentified.",
  };
}

export function inspectMenuRelatedFiles(files = [], targetTitleId = "CUSA00419") {
  const synapse = inspectSynapseMenuPack(files, targetTitleId);
  const vehicleXml = files.filter((file) => /\.xml$/i.test(file.path)).map(inspectVehicleXmlPreset);
  return {
    synapse, vehicleXml,
    summary: {
      hasSynapsePack: Boolean(synapse), xmlFiles: vehicleXml.length,
      validVehicleXml: vehicleXml.filter((item) => item.validXml).length,
      detectedMenyooXml: vehicleXml.filter((item) => item.format === "menyoo-spooner-vehicle-xml").length,
    },
  };
}
