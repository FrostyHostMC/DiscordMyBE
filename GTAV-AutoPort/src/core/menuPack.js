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

function basename(path) {
  return path.replaceAll("\\", "/").split("/").at(-1).toLowerCase();
}

function parsePluginIni(text) {
  const entries = [];
  let titleId = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const section = line.match(/^\[([A-Z0-9]{9})\]$/i);
    if (section) { titleId = section[1].toUpperCase(); continue; }
    if (!titleId || !line.startsWith("/data/GoldHEN/plugins/")) continue;
    const [rawPath, ...flags] = line.split("=");
    const path = rawPath.trim();
    entries.push({
      titleId,
      path,
      extension: path.split(".").at(-1).toLowerCase(),
      flags: flags.join("=").trim(),
    });
  }
  return entries;
}

function parseIni(text) {
  const sections = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      current = { name: section[1], settings: [] };
      sections.push(current);
      continue;
    }
    const split = line.indexOf("=");
    if (current && split > 0) {
      current.settings.push({ key: line.slice(0, split).trim(), value: line.slice(split + 1).trim() });
    }
  }
  return {
    sections,
    sectionCount: sections.length,
    settingCount: sections.reduce((sum, section) => sum + section.settings.length, 0),
  };
}

function inspectJsonCatalog(file) {
  const source = textOf(file).trim();
  if (!source) {
    return { path: file.path, state: "empty-placeholder", validJson: null, categoryCount: 0, itemCount: 0, categoryNames: [], duplicateCount: 0, duplicates: [] };
  }
  try {
    const value = JSON.parse(source);
    const isArray = Array.isArray(value);
    if (!isArray && (!value || typeof value !== "object")) {
      return { path: file.path, state: "valid-json-wrong-shape", validJson: true, categoryCount: 0, itemCount: 0, categoryNames: [], duplicateCount: 0, duplicates: [], valueType: typeof value };
    }
    const categoryNames = isArray ? [] : Object.keys(value);
    const values = isArray ? value : Object.values(value).flatMap((items) => Array.isArray(items) ? items : []);
    const counts = new Map();
    for (const item of values) {
      const key = typeof item === "string" ? item : JSON.stringify(item);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
    return {
      path: file.path,
      state: "valid-json",
      validJson: true,
      valueType: isArray ? "array" : "category-map",
      categoryCount: categoryNames.length,
      categoryNames,
      itemCount: values.length,
      duplicateCount: duplicates.length,
      duplicates: duplicates.slice(0, 25),
    };
  } catch (error) {
    return { path: file.path, state: "invalid-json", validJson: false, categoryCount: 0, itemCount: 0, categoryNames: [], duplicateCount: 0, duplicates: [], error: error.message };
  }
}

function readSelfSignature(file) {
  const bytes = file?.bytes || new Uint8Array();
  const signature = [...bytes.slice(0, 4)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    signature,
    isPs4SelfContainer: signature === "4f153d1d",
    format: signature === "4f153d1d" ? "PS4 SELF container signature" : "unidentified binary header",
    bytes: file?.size ?? bytes.byteLength,
  };
}

/**
 * Inspects supplied Synapse menu data and GoldHEN configuration. It does not
 * execute, patch, reverse engineer, or certify the compiled SPRX.
 */
export function inspectSynapseMenuPack(files = [], targetTitleId = "CUSA00419") {
  const normalizedFiles = files.map((file) => ({ ...file, normalizedPath: file.path.replaceAll("\\", "/") }));
  const menuFiles = normalizedFiles.filter((file) => file.normalizedPath.toLowerCase().includes("synapse/files/"));
  if (!menuFiles.length) return null;

  const catalogs = menuFiles.filter((file) => /\.json$/i.test(file.path)).map(inspectJsonCatalog);
  const pluginFile = normalizedFiles.find((file) => basename(file.path) === "plugins.ini");
  const plugins = pluginFile ? parsePluginIni(textOf(pluginFile)) : [];
  const targetPlugins = plugins.filter((item) => item.titleId === targetTitleId);
  const settingsFile = menuFiles.find((file) => basename(file.path) === "settings.ini");
  const settings = settingsFile ? parseIni(textOf(settingsFile)) : { sections: [], sectionCount: 0, settingCount: 0 };
  const sprx = normalizedFiles.find((file) => basename(file.path) === "synapse.sprx");
  const sprxHeader = readSelfSignature(sprx);
  const xmlFiles = menuFiles.filter((file) => /\.xml$/i.test(file.path));
  const warnings = [];

  if (!pluginFile) warnings.push("No plugins.ini was included.");
  if (!targetPlugins.length) warnings.push("No GoldHEN plugin entry was found for " + targetTitleId + ".");
  if (!sprx) warnings.push("Synapse SPRX binary was not included.");
  else if (!sprxHeader.isPs4SelfContainer) warnings.push("The Synapse binary does not have the recognized PS4 SELF header signature.");
  if (catalogs.some((item) => item.state === "invalid-json")) warnings.push("One or more JSON catalogs contain invalid JSON.");
  if (catalogs.some((item) => item.duplicateCount > 0)) warnings.push("One or more JSON catalogs contain duplicate entries.");
  if (catalogs.some((item) => item.state === "empty-placeholder")) warnings.push("One or more catalog files are empty placeholders and currently provide no entries.");
  if (!xmlFiles.length) warnings.push("No XML files were supplied. The menu's XML loader schema and support cannot be confirmed from this package.");
  else warnings.push("XML files were found, but loader compatibility requires the menu source or an on-console test.");

  return {
    format: "synapse-menu-data",
    targetTitleId,
    catalogs,
    plugins,
    targetPlugins,
    settings,
    hasSynapseBinary: Boolean(sprx),
    synapseBinaryPath: sprx?.path || null,
    sprxHeader,
    xmlFiles: xmlFiles.map((item) => item.path),
    summary: {
      catalogFiles: catalogs.length,
      validCatalogs: catalogs.filter((item) => item.state === "valid-json").length,
      emptyCatalogs: catalogs.filter((item) => item.state === "empty-placeholder").length,
      invalidCatalogs: catalogs.filter((item) => item.state === "invalid-json" || item.state === "valid-json-wrong-shape").length,
      catalogItems: catalogs.reduce((sum, item) => sum + item.itemCount, 0),
      duplicateEntries: catalogs.reduce((sum, item) => sum + item.duplicateCount, 0),
      targetPluginEntries: targetPlugins.length,
      allPluginEntries: plugins.length,
      settingsSections: settings.sectionCount,
      settingsValues: settings.settingCount,
      xmlFiles: xmlFiles.length,
    },
    warnings,
    compatibility: "inventory-only-unverified",
    note: "GoldHEN plugin configuration and a PS4 SELF header signature are recognized. This does not validate the SPRX executable, menu hooks, XML support, or CUSA00419 update compatibility.",
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
