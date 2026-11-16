const ORBX_PLUGIN_NAME = "orbx.prx";
const ORBX_CONFIG_NAME = "orbx.ini";
const ORBX_LOG_NAME = "rpf_log.txt";
const ORBX_INSTRUCTIONS_NAME = "Instructions.txt";
const MAX_INI_BYTES = 64 * 1024;
const MAX_LOG_BYTES = 1024 * 1024;
const MAX_LOG_SIGNALS = 100;

function normalizedPath(value) {
  return String(value || "").replaceAll(String.fromCharCode(92), "/").replace(/^\.\//, "").toLowerCase();
}

function fileBytes(file) {
  const value = file?.bytes;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function fileSize(file) {
  const bytes = fileBytes(file);
  return bytes?.byteLength ?? (Number.isFinite(Number(file?.size)) ? Number(file.size) : 0);
}

function findByBasename(files, basename) {
  const target = basename.toLowerCase();
  return files
    .filter((file) => normalizedPath(file?.path).split("/").at(-1) === target)
    .map((file) => ({
      path: String(file.path),
      bytes: fileSize(file)
    }));
}

function parseIniFile(file) {
  const bytes = fileBytes(file);
  if (!bytes) {
    return { status: "not-provided", sections: [], settings: [], duplicateKeys: [], malformedLines: [], hasAvoidCrcCheckedFiles: false };
  }
  if (bytes.byteLength > MAX_INI_BYTES) {
    return { status: "too-large-to-inspect", byteLength: bytes.byteLength, sections: [], settings: [], duplicateKeys: [], malformedLines: [], hasAvoidCrcCheckedFiles: false };
  }

  const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
  if (text.includes("\u0000")) {
    return { status: "not-plain-text", byteLength: bytes.byteLength, sections: [], settings: [], duplicateKeys: [], malformedLines: [], hasAvoidCrcCheckedFiles: false };
  }

  const sections = [];
  const settings = [];
  const malformedLines = [];
  const seen = new Set();
  const duplicateKeys = [];
  let currentSection = "";

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      sections.push(currentSection);
      continue;
    }

    const equalsAt = line.indexOf("=");
    if (equalsAt <= 0) {
      malformedLines.push(index + 1);
      continue;
    }

    const key = line.slice(0, equalsAt).trim();
    const value = line.slice(equalsAt + 1).trim();
    if (!key) {
      malformedLines.push(index + 1);
      continue;
    }

    const identity = currentSection.toLowerCase() + "\u0000" + key.toLowerCase();
    if (seen.has(identity)) duplicateKeys.push({ section: currentSection, key, line: index + 1 });
    seen.add(identity);
    settings.push({ section: currentSection, key, value, line: index + 1 });
  }

  return {
    status: malformedLines.length || duplicateKeys.length ? "parsed-with-warnings" : "parsed",
    byteLength: bytes.byteLength,
    sections,
    settings,
    duplicateKeys,
    malformedLines,
    hasAvoidCrcCheckedFiles: settings.some((setting) => setting.key.toLowerCase() === "avoidcrccheckedfiles")
  };
}

function parseRuntimeLog(file) {
  const bytes = fileBytes(file);
  if (!bytes) return { status: "not-provided", lineCount: 0, signals: [] };
  if (bytes.byteLength > MAX_LOG_BYTES) {
    return { status: "too-large-to-inspect", byteLength: bytes.byteLength, lineCount: 0, signals: [] };
  }

  const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
  if (text.includes("\u0000")) {
    return { status: "not-plain-text", byteLength: bytes.byteLength, lineCount: 0, signals: [] };
  }

  const lines = text.split(/\r?\n/);
  const signals = [];
  const signalPattern = /\b(error|failed|failure|unsupported|not supported|crc|warning|warn|cannot|missing|invalid|denied|exception|unable)\b|\bversion\b.{0,48}\b(mismatch|unsupported|not supported|invalid|incompatible|expected|required)\b|\b(mismatch|incompatible)\b.{0,48}\bversion\b/i;
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || !signalPattern.test(line)) continue;
    if (signals.length >= MAX_LOG_SIGNALS) break;
    signals.push({
      line: index + 1,
      category: /error|failed|failure|exception|unable|cannot|denied|invalid/i.test(line) ? "error"
        : /unsupported|not supported|version.{0,48}(mismatch|unsupported|not supported|invalid|incompatible|expected|required)|(mismatch|incompatible).{0,48}version/i.test(line) ? "compatibility"
          : /crc/i.test(line) ? "crc"
            : "warning",
      text: line.slice(0, 300)
    });
  }

  return {
    status: signals.length ? "parsed-with-signals" : "parsed-no-obvious-signals",
    byteLength: bytes.byteLength,
    lineCount: lines.length,
    signals
  };
}

function extensionOf(path) {
  const name = String(path || "").split("/").at(-1).toLowerCase();
  const index = name.lastIndexOf(".");
  return index < 0 ? "[no-extension]" : name.slice(index);
}

function hasRepeatedAdjacentFolder(path) {
  const parts = String(path || "").replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.some((part, index) => index > 0 && part.toLowerCase() === parts[index - 1].toLowerCase());
}

/**
 * Read-only inventory and optional INI syntax audit for the ORBX Engine package.
 * It never edits PRX binaries, invents INI values, executes package scripts,
 * or treats a matching filename as proof of runtime compatibility.
 */
export function inspectOrbxPackage(files = []) {
  if (!Array.isArray(files)) throw new Error("files must be an array.");

  const pluginFiles = findByBasename(files, ORBX_PLUGIN_NAME);
  const configFileRecords = files.filter((file) => normalizedPath(file?.path).split("/").at(-1) === ORBX_CONFIG_NAME);
  const configFiles = configFileRecords.map((file) => ({ path: String(file.path), bytes: fileSize(file) }));
  const logFileRecords = files.filter((file) => normalizedPath(file?.path).split("/").at(-1) === ORBX_LOG_NAME);
  const logFiles = logFileRecords.map((file) => ({ path: String(file.path), bytes: fileSize(file) }));
  const instructionFiles = findByBasename(files, ORBX_INSTRUCTIONS_NAME);
  const rpfFiles = files
    .filter((file) => normalizedPath(file?.path).endsWith(".rpf"))
    .map((file) => ({ path: String(file.path), bytes: fileSize(file) }));
  const gtaResourceEntries = files.filter((file) => {
    const path = normalizedPath(file?.path);
    return path.includes("/orbx/gta/") || path.startsWith("orbx/gta/");
  });
  const gtaResourceFiles = gtaResourceEntries.length;
  const resourceExtensionCounts = {};
  const rpfPathMarkers = [];
  for (const file of gtaResourceEntries) {
    const path = String(file.path);
    const lowerPath = normalizedPath(path);
    if (lowerPath.endsWith(".rpf.txt")) {
      if (rpfPathMarkers.length < 20) rpfPathMarkers.push(path);
      continue;
    }
    const extension = extensionOf(path);
    resourceExtensionCounts[extension] = (resourceExtensionCounts[extension] || 0) + 1;
  }

  const pluginPresent = pluginFiles.length > 0;
  const configPresent = configFiles.length > 0;
  const duplicatePlugin = pluginFiles.length > 1;
  const duplicateConfig = configFiles.length > 1;
  const detected = pluginPresent && configPresent;
  const runtimeLogAnalysis = logFileRecords.length === 1 ? parseRuntimeLog(logFileRecords[0]) : {\n    status: logFileRecords.length > 1 ? "ambiguous-multiple-files" : "not-available",\n    lineCount: 0,\n    signals: []\n  };\n  const iniAnalysis = configFileRecords.length === 1 ? parseIniFile(configFileRecords[0]) : {
    status: configFileRecords.length > 1 ? "ambiguous-multiple-files" : "not-available",
    sections: [],
    settings: [],
    duplicateKeys: [],
    malformedLines: [],
    hasAvoidCrcCheckedFiles: false
  };
  const packagePaths = [...pluginFiles, ...configFiles, ...logFiles].map((file) => file.path);
  const repeatedFolderPaths = packagePaths.filter(hasRepeatedAdjacentFolder);

  const warnings = [];
  if (!pluginPresent) warnings.push("ORBX plugin binary orbx.prx was not found in the imported files.");
  if (!configPresent) warnings.push("ORBX configuration orbx.ini was not found; do not create an empty replacement because the required keys and values have not been verified.");
  if (duplicatePlugin) warnings.push("Multiple orbx.prx files were found. Select the matching package copy instead of installing an arbitrary duplicate.");
  if (duplicateConfig) warnings.push("Multiple orbx.ini files were found. Compare their package paths before staging one.");
  if (pluginPresent && configPresent) warnings.push("The plugin and INI are both present, but filename presence does not validate PRX architecture, GoldHEN loading, game hooks, or graphics-resource compatibility.");
  if (iniAnalysis.status === "not-provided") warnings.push("The INI file was inventoried but its bytes were not supplied, so its settings could not be parsed.");
  if (iniAnalysis.status === "parsed-with-warnings") warnings.push("The INI contains duplicate keys or malformed lines; inspect the reported line numbers before installing it.");
  if (iniAnalysis.status === "not-plain-text") warnings.push("The INI bytes contain NUL characters and were not treated as a plain-text configuration.");
  if (iniAnalysis.status === "too-large-to-inspect") warnings.push("The INI exceeds the safe parser size limit and was not parsed.");\n  if (iniAnalysis.status === "parsed" && iniAnalysis.settings.length === 0) warnings.push("The INI is readable but contains no settings; confirm this is the intended ORBX configuration before staging it.");\n  if (runtimeLogAnalysis.status === "parsed-with-signals") warnings.push("The ORBX runtime log contains diagnostic lines worth reviewing; see runtimeLog.analysis.signals for bounded excerpts and line numbers.");\n  if (runtimeLogAnalysis.status === "too-large-to-inspect") warnings.push("The ORBX runtime log exceeds the safe parser size limit and was not parsed.");\n  if (runtimeLogAnalysis.status === "not-plain-text") warnings.push("The ORBX runtime log contains NUL characters and was not treated as plain text.");
  if (repeatedFolderPaths.length) warnings.push("The package contains repeated adjacent folder names. Check the archive's enclosing folders and copy the contents from the inner package root rather than preserving accidental duplicate nesting.");
  if (rpfFiles.length === 0) warnings.push("No actual .rpf archive files were found in the imported file list.");
  if (rpfPathMarkers.length) warnings.push("Files ending in .rpf.txt were found. These are path-marker/text files, not RPF archives, and must not be counted as archive payloads.");
  if (gtaResourceFiles === 0) warnings.push("No files under an orbx/gta resource directory were found; the loader may have a separate resource payload or the archive may have been extracted from the wrong folder level.");

  return {
    schemaVersion: 2,
    product: "GTAV AutoPort",
    profile: "orbx-engine-package",
    status: detected ? "package-components-detected" : "incomplete-package",
    detected,
    components: {
      plugin: {
        name: ORBX_PLUGIN_NAME,
        present: pluginPresent,
        files: pluginFiles,
        suggestedGoldHENPluginPath: pluginPresent ? "/data/GoldHEN/plugins/orbx.prx" : null
      },
      configuration: {
        name: ORBX_CONFIG_NAME,
        present: configPresent,
        files: configFiles,
        expectedRuntimePath: configPresent ? "/data/orbx/orbx.ini" : null,
        contentsInspected: iniAnalysis.status === "parsed" || iniAnalysis.status === "parsed-with-warnings",
        iniAnalysis
      },
      runtimeLog: { name: ORBX_LOG_NAME, present: logFiles.length > 0, files: logFiles, analysis: runtimeLogAnalysis },
      instructions: { name: ORBX_INSTRUCTIONS_NAME, present: instructionFiles.length > 0, files: instructionFiles },
      resourceArchives: rpfFiles,
      gtaResourceTreeFileCount: gtaResourceFiles,
      resourceExtensionCounts,
      rpfPathMarkerCount: gtaResourceEntries.filter((file) => normalizedPath(file?.path).endsWith(".rpf.txt")).length,
      rpfPathMarkerSamples: rpfPathMarkers
    },
    packageLayout: {
      repeatedAdjacentFolderPaths: repeatedFolderPaths,
      hasRepeatedAdjacentFolderNames: repeatedFolderPaths.length > 0
    },
    installReview: {
      pluginAndConfigBothPresent: detected,
      suggestedConfigPath: configPresent ? "/data/orbx/orbx.ini" : null,
      deploymentAuthorized: false,
      runtimeCompatibilityVerified: false
    },
    warnings,
    limitations: [
      "This is an inventory and optional plain-text INI syntax audit; it does not patch PRX binaries, execute package scripts, deploy files or establish runtime compatibility.",
      "INI key names and values are reported as found; the inspector does not assume undocumented keys are valid or generate missing settings.",
      "A PRX filename does not prove Orbis architecture, GoldHEN compatibility, correct title hooks, or successful initialization.",
      "RPF presence does not prove that its contents are compatible with the running game or the selected loader.",
      "Files ending in .rpf.txt are reported as path markers and are never treated as RPF archives."
    ]
  };
}
