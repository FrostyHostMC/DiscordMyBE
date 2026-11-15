import JSZip from "jszip";
import { convertLegacyResourceCandidate } from "./resourceConversion.js";

const CONVERTIBLE = new Set([".yft", ".ydr", ".ydd", ".ytd"]);
function safePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("The imported file list contains an unsafe relative path.");
  }
  return parts.join("/");
}

function extension(path) {
  const name = String(path || "").split("/").at(-1);
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}

/**
 * Builds one local hand-off ZIP for an imported mod. Original files are retained;
 * only successful RageKit PC Legacy candidates are placed in the candidate tree.
 * This deliberately does not label the ZIP as PS4-installable.
 */
export async function buildAutomaticPrepBundle({ sourceName = "pc-mod", files = [], target, reports = {}, onProgress = () => {} } = {}) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("Import a PC mod before building its preparation bundle.");
  const zip = new JSZip();
  const root = zip.folder("AutoPort-Prep");
  const originalRoot = root.folder("source-original");
  const candidateRoot = root.folder("pc-legacy-candidates");
  const sourceManifest = [];
  const conversions = [];
  let completed = 0;
  const eligible = files.filter((file) => CONVERTIBLE.has(extension(file.path)));
  for (const file of files) {
    const relative = safePath(file.path);
    if (!relative) continue;
    originalRoot.file(relative, file.bytes);
    sourceManifest.push({ path: relative, bytes: file.bytes?.byteLength ?? file.size ?? 0, preserved: true });
  }
  for (const file of eligible) {
    const relative = safePath(file.path);
    const record = { sourcePath: relative, extension: extension(relative), status: "failed", outputPath: null, outputBytes: 0, roundtripVerified: false, error: null, targetCompatibility: "unverified" };
    try {
      const converted = await convertLegacyResourceCandidate(file);
      if (!converted.bytes?.length || !converted.roundtripVerified) throw new Error("RageKit did not confirm a successful output round-trip.");
      record.status = "pc-legacy-candidate";
      record.outputPath = relative;
      record.outputBytes = converted.bytes.length;
      record.roundtripVerified = true;
      candidateRoot.file(relative, converted.bytes);
    } catch (error) {
      record.error = error?.message || "Conversion failed.";
    }
    conversions.push(record);
    completed += 1;
    onProgress({ completed, total: eligible.length, current: relative, status: record.status });
  }
  const manifest = {
    schemaVersion: 1,
    product: "GTAV AutoPort",
    bundleType: "automatic-source-preparation",
    sourceName,
    target: target || null,
    createdAt: new Date().toISOString(),
    summary: {
      importedFiles: sourceManifest.length,
      convertibleCandidates: eligible.length,
      convertedPcLegacyCandidates: conversions.filter((item) => item.status === "pc-legacy-candidate").length,
      failedCandidates: conversions.filter((item) => item.status === "failed").length,
      originalFilesPreserved: sourceManifest.length,
      ps4ReadyFiles: 0,
      installable: false
    },
    sourceFiles: sourceManifest,
    conversions,
    limitations: [
      "Converted outputs are GTA V PC Legacy-format candidates, not certified PS4 resources.",
      "CUSA00419 / GTA V 1.73 resource encoding and in-game behavior are not verified.",
      "PC ASI/DLL/EXE plugins and runtime-dependent scripts are preserved as source only; they are not executable PS4 plugins.",
      "RPF archives and metadata are preserved unchanged unless a dedicated validated adapter reports otherwise.",
      "Do not overwrite original game files. Review the included report and use a reversible deployment method only after target validation."
    ]
  };
  const reportRoot = root.folder("reports");
  for (const [name, value] of Object.entries(reports)) {
    if (value !== undefined && value !== null) reportRoot.file(name.replace(/[^a-zA-Z0-9._-]/g, "_") + ".json", JSON.stringify(value, null, 2));
  }
  root.file("autoport-manifest.json", JSON.stringify(manifest, null, 2));
  root.file("README-FIRST.txt", [
    "GTAV AUTOPORT — AUTOMATIC PREPARATION BUNDLE",
    "",
    "1. source-original/ contains the original imported mod files.",
    "2. pc-legacy-candidates/ contains only resources successfully rewritten and round-trip checked by RageKit for GTA V PC Legacy.",
    "3. autoport-manifest.json records every conversion result and limitation.",
    "",
    "IMPORTANT: This is not a PS4 install package. PC Legacy output is not proof of PS4 compatibility.",
    "The target CUSA00419 / GTA V 1.73 writer and runtime still require exact-build validation.",
    "Never copy these files over original game files without a verified, reversible deployment plan."
  ].join("\n"));
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { blob, manifest };
}
