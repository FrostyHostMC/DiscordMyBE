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
  if (expectedType === "YFT" && (!report.fragment || typeof report.fragment !== "object")) {
    throw new Error(`The ${file.path} report is missing its YFT fragment summary.`);
  }
  if (expectedType === "YTD" && !Array.isArray(report.textures)) {
    throw new Error(`The ${file.path} report is missing its texture list.`);
  }
  return report;
}

/**
 * Loads the native inspector's JSON reports and links PNG previews from the
 * same imported output folder. Original bytes are retained in memory only.
 */
export function inspectNativeReports(files) {
  const yftFiles = files.filter((file) => {\n    const name = basename(file.path);\n    return name === "yft-inspection.json" || name.endsWith("-yft-inspection.json");\n  });
  const ytdFiles = files.filter((file) => basename(file.path) === "ytd-inspection.json");
  if (yftFiles.length + ytdFiles.length === 0) {
    throw new Error("No yft-inspection.json or ytd-inspection.json was found. Import the native inspector output folder.");
  }
  if (yftFiles.length > 1 || ytdFiles.length > 1) {
    throw new Error("Multiple reports of the same resource type were found. Import one inspection output set at a time.");
  }

  const reports = {};
  reports.yftReports = yftFiles.map((file) => parseReport(file, "YFT"));\n  reports.yft = reports.yftReports[0] ?? null;
  if (ytdFiles[0]) {
    const report = parseReport(ytdFiles[0], "YTD");
    reports.ytd = {
      ...report,
      textures: report.textures.map((texture) => {
        const previewPath = typeof texture.preview_png === "string" ? texture.preview_png : null;
        const safePreviewPath = previewPath && !previewPath.includes("\\") && !previewPath.startsWith("/") && !previewPath.split("/").some((part) => part === "." || part === "..") && previewPath.toLowerCase().endsWith(".png");
        const preview = safePreviewPath
          ? files.find((file) => file.path.toLowerCase() === previewPath.toLowerCase() && file.bytes?.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => file.bytes[index] === value))
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
    yft: reports.yft ?? null,\n    yftReports: reports.yftReports,
    ytd: reports.ytd ?? null,
    loadedAt: new Date().toISOString(),
  };
}
