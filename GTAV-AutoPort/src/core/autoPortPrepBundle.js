import JSZip from "jszip";
import { registeredFormatAdapterRegistry } from "./registeredFormatAdapters.js";
import { analyzeModDependencies } from "./modDependencyGraph.js";
import { extractOpenRpf7, inspectOpenRpf7 } from "./rpf7OpenInspector.js";
import { buildPs4DeliveryPlan } from "./ps4DeliveryPlanner.js";

function safePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("The imported file list contains an unsafe relative path.");
  }
  return parts.join("/");
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
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
  const normalizedFiles = files.map((file) => ({ ...file, bytes: asBytes(file.bytes) }));
  const zip = new JSZip();
  const root = zip.folder("AutoPort-Prep");
  const originalRoot = root.folder("source-original");
  const candidateRoot = root.folder("pc-legacy-candidates");
  const sourceManifest = [];
  const conversions = [];
  const archiveInspections = [];
  const extractedFiles = [];
  const extractedEntryRecords = new Map();
  const extractedRoot = root.folder("rpf-extracted");
  let completed = 0;

  for (const file of normalizedFiles) {
    const bytes = file.bytes;
    if (!bytes || (extension(file.path) !== ".rpf" && !(bytes.length >= 4 && bytes[0] === 0x37 && bytes[1] === 0x46 && bytes[2] === 0x50 && bytes[3] === 0x52))) continue;
    const sourcePath = safePath(file.path);
    const record = { sourcePath, status: "unsupported-or-invalid", format: "RPF7", extractedFiles: 0, extractedBytes: 0, entries: [], error: null };
    try {
      const inspection = inspectOpenRpf7(bytes);
      record.status = "validated-not-extracted";
      record.entryCount = inspection.entryCount;
      record.fileCount = inspection.fileCount;
      record.directoryCount = inspection.directoryCount;
      record.encryption = inspection.encryption;
      record.entries = inspection.entries
        .filter((entry) => entry.type === "file")
        .map((entry) => ({
          path: entry.path,
          size: entry.size,
          archivePath: null,
          analysisPath: null,
          extracted: false,
          formatStatus: "not-extracted",
          adapterId: null,
          role: null,
          evidence: [],
          candidates: []
        }));
      const entryRecords = new Map(record.entries.map((entry) => [entry.path, entry]));
      const extracted = extractOpenRpf7(bytes);
      for (const entry of extracted) {
        const archivePath = sourcePath + "/" + safePath(entry.path);
        const analysisPath = "rpf-extracted/" + archivePath;
        const extractedFile = { path: analysisPath, bytes: entry.bytes, sourceArchive: sourcePath };
        extractedRoot.file(archivePath, entry.bytes);
        extractedFiles.push(extractedFile);
        const entryRecord = entryRecords.get(entry.path);
        if (!entryRecord) throw new Error("Extracted RPF entry is missing from the validated inventory.");
        Object.assign(entryRecord, { archivePath, analysisPath, size: entry.bytes.length, extracted: true, formatStatus: "not-inspected" });
        extractedEntryRecords.set(extractedFile, entryRecord);
        record.extractedFiles += 1;
        record.extractedBytes += entry.bytes.length;
      }
      record.status = "extracted-raw-open-archive";
    } catch (error) {
      record.error = error?.message || "RPF inspection failed.";
    }
    archiveInspections.push(record);
  }

  const analysisFiles = [...normalizedFiles, ...extractedFiles];
  const dependencyGraph = analyzeModDependencies(analysisFiles);
  const inspected = analysisFiles.map((file) => {
    try {
      const inspection = file.bytes instanceof Uint8Array
        ? registeredFormatAdapterRegistry.inspect(file)
        : { status: "unrecognized", selectedAdapterId: null, match: null, candidates: [], probeErrors: [{ adapterId: null, error: "File bytes are unavailable for format inspection." }] };
      const entryRecord = extractedEntryRecords.get(file);
      if (entryRecord) {
        entryRecord.formatStatus = inspection.status;
        entryRecord.adapterId = inspection.selectedAdapterId;
        entryRecord.role = inspection.match?.role ?? null;
        entryRecord.evidence = inspection.match?.evidence ?? [];
        entryRecord.candidates = inspection.candidates.map(({ adapterId, confidence, role }) => ({ adapterId, confidence, role }));
      }
      return { file, inspection };
    } catch (error) {
      return { file, inspection: { status: "unrecognized", selectedAdapterId: null, match: null, candidates: [], probeErrors: [{ adapterId: null, error: error?.message || "Format inspection failed." }] } };
    }
  });
  const eligible = inspected.filter(({ inspection }) => inspection.status === "recognized" && inspection.match?.capabilities.includes("convert"));

  for (const file of normalizedFiles) {
    const relative = safePath(file.path);
    if (!relative) continue;
    originalRoot.file(relative, file.bytes ?? new Uint8Array());
    sourceManifest.push({ path: relative, bytes: file.bytes?.byteLength ?? file.size ?? 0, preserved: true });
  }

  for (const { file, inspection } of eligible) {
    const relative = safePath(file.path);
    const record = {
      sourcePath: relative,
      sourceArchive: file.sourceArchive ?? null,
      extension: extension(relative),
      status: "failed",
      outputPath: null,
      outputBytes: 0,
      roundtripVerified: false,
      error: null,
      targetCompatibility: "unverified"
    };
    try {
      const converted = await registeredFormatAdapterRegistry.convert(inspection, file);
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

  const deliveryPlan = buildPs4DeliveryPlan({ files: analysisFiles, conversions, archiveInspections, target });

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
      rpfArchivesInspected: archiveInspections.length,
      rpfArchivesExtracted: archiveInspections.filter((item) => item.status === "extracted-raw-open-archive").length,
      rpfRawFilesExtracted: archiveInspections.reduce((sum, item) => sum + item.extractedFiles, 0),
      rpfRawFilesAnalyzed: extractedFiles.length,
      ps4ReadyFiles: deliveryPlan.summary.ps4ReadyFiles,
      installable: deliveryPlan.summary.installable,
      deliveryPlanItems: deliveryPlan.summary.fileCount
    },
    sourceFiles: sourceManifest,
    dependencies: dependencyGraph.summary,
    conversions,
    archiveInspections,
    deliveryPlan,
    limitations: [
      "Converted outputs are GTA V PC Legacy-format candidates, not certified PS4 resources.",
      "CUSA00419 / GTA V 1.73 resource encoding and in-game behavior are not verified.",
      "PC ASI/DLL/EXE plugins and runtime-dependent scripts are preserved as source only; they are not executable PS4 plugins.",
      "Supported PC RPF7 OPEN archives are extracted as raw files and included in dependency analysis and format classification; extraction itself does not decode or convert payloads.",
      "Encrypted or Orbis/PS4 RPF variants are preserved unchanged when the OPEN inspector cannot validate them.",
      "Do not overwrite original game files. Review the included report and use a reversible deployment method only after target validation."
    ]
  };

  const reportRoot = root.folder("reports");
  reportRoot.file("dependency-graph.json", JSON.stringify(dependencyGraph, null, 2));
  reportRoot.file("ps4-delivery-plan.json", JSON.stringify(deliveryPlan, null, 2));
  for (const [name, value] of Object.entries(reports)) {
    if (value !== undefined && value !== null) reportRoot.file(name.replace(/[^a-zA-Z0-9._-]/g, "_") + ".json", JSON.stringify(value, null, 2));
  }
  root.file("autoport-manifest.json", JSON.stringify(manifest, null, 2));
  root.file("README-FIRST.txt", [
    "GTAV AUTOPORT — AUTOMATIC PREPARATION BUNDLE",
    "",
    "1. source-original/ contains the original imported mod files.",
    "2. pc-legacy-candidates/ contains only resources successfully rewritten and round-trip checked by RageKit for GTA V PC Legacy.",
    "3. rpf-extracted/ contains raw files extracted from supported PC RPF7 OPEN archives; original RPF files remain preserved.",
    "4. reports/dependency-graph.json lists detected file references, resolved targets, missing references and ambiguous matches.",
    "5. reports/ps4-delivery-plan.json explains the per-file PS4 route, blockers and required validation.",
    "6. autoport-manifest.json records conversion, archive inspection and delivery planning results.",
    "",
    "IMPORTANT: This is not a PS4 install package. PC Legacy output is not proof of PS4 compatibility.",
    "The target CUSA00419 / GTA V 1.73 writer and runtime still require exact-build validation.",
    "Never copy these files over original game files without a verified, reversible deployment plan."
  ].join("\n"));
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { blob, manifest };
}
