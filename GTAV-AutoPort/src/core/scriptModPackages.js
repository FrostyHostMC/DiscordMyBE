import { XMLParser, XMLValidator } from "fast-xml-parser";

const RUNTIME_EXTENSIONS = new Set([".asi", ".dll", ".cs", ".lua", ".js", ".ysc", ".prx", ".sprx"]);
const basename = (path) => path.replaceAll("\\", "/").split("/").at(-1);
const directory = (path) => path.replaceAll("\\", "/").split("/").slice(0, -1).join("/");
const extension = (path) => {
  const name = basename(path);
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
};
const decode = (file) => new TextDecoder("utf-8", { fatal: false }).decode(file.bytes || new Uint8Array());

function collectKeys(value, pattern, found = []) {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, pattern, found));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (pattern.test(key)) found.push({ key, value: child });
      collectKeys(child, pattern, found);
    }
  }
  return found;
}

function inspectConfigXml(file) {
  const source = decode(file);
  const validation = XMLValidator.validate(source);
  if (validation !== true) {
    return { path: file.path, validXml: false, error: validation.err?.msg || "Invalid XML", signals: {} };
  }
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => /^(House|Home|Entry|Location|Property|Apartment)$/i.test(name),
  }).parse(source);
  const signals = {
    houseOrLocationEntries: collectKeys(parsed, /^(House|Home|Entry|Location|Property|Apartment)$/i).length,
    homeTypeFields: collectKeys(parsed, /^HomeType$/i).length,
    coordinateFields: collectKeys(parsed, /^(X|Y|Z|Position|Coordinates|Heading)$/i).length,
    markerSettings: collectKeys(parsed, /marker/i).length,
    alertOrPoliceSettings: collectKeys(parsed, /(alert|police|wanted|dispatch)/i).length,
    maskSettings: collectKeys(parsed, /mask/i).length,
    rewardSettings: collectKeys(parsed, /(reward|cash|money|loot)/i).length,
    pedOrResidentSettings: collectKeys(parsed, /(ped|resident|guard|occupant)/i).length,
  };
  return { path: file.path, validXml: true, rootName: Object.keys(parsed)[0] || "unknown", signals };
}

/**
 * Groups script-based PC mods with nearby XML/config files. This is source
 * triage only: it never treats a Windows DLL/ASI or PC script as PS4 payload.
 */
export function inspectScriptModPackages(files = []) {
  const groups = new Map();
  for (const file of files) {
    const ext = extension(file.path);
    if (!RUNTIME_EXTENSIONS.has(ext) && ext !== ".xml" && ext !== ".ini" && ext !== ".json") continue;
    const dir = directory(file.path);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(file);
  }

  const packages = [];
  for (const [dir, entries] of groups) {
    const runtimeFiles = entries.filter((file) => RUNTIME_EXTENSIONS.has(extension(file.path)));
    if (!runtimeFiles.length) continue;
    const configFiles = entries.filter((file) => [".xml", ".ini", ".json"].includes(extension(file.path)));
    const xmlReports = configFiles.filter((file) => extension(file.path) === ".xml").map(inspectConfigXml);
    const allNames = entries.map((file) => basename(file.path).toLowerCase()).join(" ");
    const allText = configFiles.map(decode).join("\n").toLowerCase();
    const isHomeInvasion = /home.?invasion/.test(allNames) || /home.?invasion/.test(allText) ||
      (/hometype/.test(allText) && /(house|rob|resident|police)/.test(allText));
    const pcRuntimeFiles = runtimeFiles.filter((file) => [".asi", ".dll", ".cs", ".lua", ".js"].includes(extension(file.path)));
    const consolePlugins = runtimeFiles.filter((file) => [".prx", ".sprx"].includes(extension(file.path)));
    packages.push({
      directory: dir || ".",
      label: isHomeInvasion ? "Home Invasion-style script mod" : "Script/runtime mod",
      runtimeFiles: runtimeFiles.map((file) => ({ path: file.path, extension: extension(file.path), bytes: file.size ?? file.bytes?.byteLength ?? 0 })),
      configFiles: configFiles.map((file) => ({ path: file.path, extension: extension(file.path) })),
      xmlReports,
      classification: isHomeInvasion ? "scripted-gameplay-mod" : "runtime-dependent-mod",
      pcRuntimeCount: pcRuntimeFiles.length,
      consolePluginCount: consolePlugins.length,
      requiresNativeReimplementation: pcRuntimeFiles.length > 0,
      behaviorPortStatus: pcRuntimeFiles.length ? "not-ported-native-runtime-required" : "console-plugin-present-needs-target-validation",
      notes: [
        ...(pcRuntimeFiles.length ? ["PC ASI/DLL/.NET/script files are source inputs only; they cannot be loaded as GoldHEN PRX plugins."] : []),
        ...(configFiles.length ? ["Configuration is inventoried separately; XML data does not implement the runtime behavior."] : []),
        ...(isHomeInvasion ? ["Home Invasion-style features such as entry logic, resident AI, alarms, police response and rewards require behavior-level implementation; only fields actually present in the XML are candidates for data conversion."] : []),
      ],
    });
  }

  return {
    packages,
    summary: {
      packageCount: packages.length,
      runtimeFiles: packages.reduce((sum, item) => sum + item.runtimeFiles.length, 0),
      configFiles: packages.reduce((sum, item) => sum + item.configFiles.length, 0),
      pcRuntimeFiles: packages.reduce((sum, item) => sum + item.pcRuntimeCount, 0),
      consolePlugins: packages.reduce((sum, item) => sum + item.consolePluginCount, 0),
      xmlFiles: packages.reduce((sum, item) => sum + item.xmlReports.length, 0),
      homeInvasionLike: packages.filter((item) => item.classification === "scripted-gameplay-mod").length,
    },
  };
}
