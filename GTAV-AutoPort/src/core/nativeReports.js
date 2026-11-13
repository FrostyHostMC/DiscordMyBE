const REPORT_NAMES = new Set(["yft-inspection.json", "ytd-inspection.json"]);

function basename(path) {
  return path.split("/").at(-1).toLowerCase();
}

function parseReport(file, expectedType) {
  let report;
  try {
    report = JSON.parse(new TextDecoder().decode(file.bytes));
  } catch {
    throw new Error(`The ${file.path} report is not valid JSON.`);
  }
  if (report?.schema_version !== 1 || report?.tool !== "GTAV AutoPort Native Inspector") {
    throw new Error(`Unsupported native inspection report schema in ${file.path}.`);
  }
  if (report.resource_type !== expectedType || report.parse_result !== "success") {
    throw new Error(`The ${file.path} report is not a successful ${expectedType} inspection.`);
  }
  return report;
}

/**
 * Loads the native inspector's JSON reports and links PNG previews from the
 * same imported output folder. Original bytes are retained in memory only.
 */
export function inspectNativeReports(files) {
  const yftFiles = files.filter((file) => basename(file.path) === "yft-inspection.json");
  const ytdFiles = files.filter((file) => basename(file.path) === "ytd-inspection.json");
  if (yftFiles.length + ytdFiles.length === 0) {
    throw new Error("No yft-inspection.json or ytd-inspection.json was found. Import the native inspector output folder.");
  }
  if (yftFiles.length > 1 || ytdFiles.length > 1) {
    throw new Error("Multiple reports of the same resource type were found. Import one inspection output set at a time.");
  }

  const reports = {};
  if (yftFiles[0]) reports.yft = parseReport(yftFiles[0], "YFT");
  if (ytdFiles[0]) {
    const report = parseReport(ytdFiles[0], "YTD");
    if (!Array.isArray(report.textures)) throw new Error("The YTD report is missing its texture list.");
    reports.ytd = {
      ...report,
      textures: report.textures.map((texture) => {
        const previewPath = typeof texture.preview_png === "string" ? texture.preview_png : null;
        const preview = previewPath
          ? files.find((file) => file.path.toLowerCase() === previewPath.toLowerCase())
          : null;
        return {
          ...texture,
          previewBytes: preview?.bytes ?? null,
          previewAvailable: Boolean(preview),
        };
      }),
    };
  }
  return {
    sourceFiles: files.length,
    yft: reports.yft ?? null,
    ytd: reports.ytd ?? null,
    loadedAt: new Date().toISOString(),
  };
}
