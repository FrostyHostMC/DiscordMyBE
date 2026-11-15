const ORBX_PLUGIN_NAME = "orbx.prx";
const ORBX_CONFIG_NAME = "orbx.ini";

function normalizedPath(value) {
  return String(value || "").replaceAll(String.fromCharCode(92), "/").replace(/^\.\//, "").toLowerCase();
}

function findByBasename(files, basename) {
  const target = basename.toLowerCase();
  return files
    .filter((file) => normalizedPath(file?.path).split("/").at(-1) === target)
    .map((file) => ({
      path: String(file.path),
      bytes: Number.isFinite(file.bytes?.byteLength) ? file.bytes.byteLength : Number(file.size) || 0
    }));
}

/**
 * Read-only inventory audit for the public ORBX Engine package layout.
 * It never edits PRX binaries, invents INI values, executes package scripts,
 * or treats a matching filename as proof of runtime compatibility.
 */
export function inspectOrbxPackage(files = []) {
  if (!Array.isArray(files)) throw new Error("files must be an array.");

  const pluginFiles = findByBasename(files, ORBX_PLUGIN_NAME);
  const configFiles = findByBasename(files, ORBX_CONFIG_NAME);
  const rpfFiles = files
    .filter((file) => normalizedPath(file?.path).endsWith(".rpf"))
    .map((file) => ({
      path: String(file.path),
      bytes: Number.isFinite(file.bytes?.byteLength) ? file.bytes.byteLength : Number(file.size) || 0
    }));
  const gtaResourceFiles = files.filter((file) => {
    const path = normalizedPath(file?.path);
    return path.includes("/orbx/gta/") || path.startsWith("orbx/gta/");
  }).length;

  const pluginPresent = pluginFiles.length > 0;
  const configPresent = configFiles.length > 0;
  const duplicatePlugin = pluginFiles.length > 1;
  const duplicateConfig = configFiles.length > 1;
  const detected = pluginPresent && configPresent;

  const warnings = [];
  if (!pluginPresent) warnings.push("ORBX plugin binary orbx.prx was not found in the imported files.");
  if (!configPresent) warnings.push("ORBX configuration orbx.ini was not found; do not create an empty replacement because the required keys and values have not been verified.");
  if (duplicatePlugin) warnings.push("Multiple orbx.prx files were found. Select the matching package copy instead of installing an arbitrary duplicate.");
  if (duplicateConfig) warnings.push("Multiple orbx.ini files were found. Compare their package paths before staging one.");
  if (pluginPresent && configPresent) warnings.push("The plugin and INI are both present, but filename presence does not validate INI syntax, PRX architecture, GoldHEN loading, game hooks, or graphics-resource compatibility.");
  if (rpfFiles.length === 0) warnings.push("No RPF archives were found alongside the ORBX package inventory.");
  if (gtaResourceFiles === 0) warnings.push("No files under an orbx/gta resource directory were found; the loader may have a separate resource payload or the archive may have been extracted from the wrong folder level.");

  return {
    schemaVersion: 1,
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
        contentsInspected: false
      },
      resourceArchives: rpfFiles,
      gtaResourceTreeFileCount: gtaResourceFiles
    },
    installReview: {
      pluginAndConfigBothPresent: detected,
      suggestedConfigPath: configPresent ? "/data/orbx/orbx.ini" : null,
      deploymentAuthorized: false,
      runtimeCompatibilityVerified: false
    },
    warnings,
    limitations: [
      "This is a path and inventory audit only; it does not parse the INI, patch the PRX, execute package scripts, or install files.",
      "The vendor's published version list is a compatibility claim, not a reason to rewrite or spoof the running game version.",
      "A PRX filename does not prove Orbis architecture, GoldHEN compatibility, correct title hooks, or successful initialization.",
      "RPF presence does not prove that its contents are compatible with the running game or the selected loader."
    ]
  };
}
