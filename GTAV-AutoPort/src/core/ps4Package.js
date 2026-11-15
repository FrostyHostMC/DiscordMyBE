import JSZip from "jszip";
import { PS4_TARGET } from "./target.js";

const SAFE_TITLE = /^CUSA\\d{5}$/;
const FORBIDDEN = /[\\\\\\0]|%(?:2e|2f|5c)/i;

async function sha256(bytes) {\n  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 support is unavailable in this runtime.");\n  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);\n  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");\n}\n\nfunction safeAppPath(value) {
  if (typeof value !== "string" || !value.startsWith("/app0/") || FORBIDDEN.test(value)) {
    throw new Error("Every overlay destination must be an explicit safe /app0/... path.");
  }
  const parts = value.slice(6).split("/");
  if (!parts.length || parts.some((part) => !part || part === "." || part === ".." || part.includes(":"))) {
    throw new Error("Overlay destination contains an unsafe path segment.");
  }
  return parts.join("/");
}

/**
 * Build a GoldHEN AFR handoff only from complete PS4 RPF7 containers.
 * This does not convert PC resources: source-build and destination-path attestations
 * are mandatory, and the archive bytes are preserved exactly.
 */
export async function buildPs4AfrPackage({ files = [], mappings = {}, target = PS4_TARGET, attestations = {} } = {}) {
  if (!SAFE_TITLE.test(String(target.titleId || ""))) throw new Error("A valid CUSA title ID is required.");
  if (!attestations.ps4ResourceBuildVerified) throw new Error("Confirm that each selected RPF was built for the PS4 GTA V target. PC RPF archives cannot be relabeled as PS4.");
  if (!attestations.destinationPathsVerified) throw new Error("Confirm that every /app0 destination is verified for this exact title and update.");
  if (!files.length) throw new Error("Select at least one complete PS4 RPF archive.");
  const zip = new JSZip();
  const manifest = {
    schemaVersion: 1,
    packageType: "goldhen-afr-ps4-rpf-overlay",
    target: { titleId: target.titleId, game: target.game, updateVersion: target.updateVersion, mode: target.mode },
    conversionPerformed: false,
    sourceBytesPreserved: true,
    entries: [],
    requiredOnConsole: ["/data/GoldHEN/plugins/afr.prx"],
    limitations: [
      "This package stages already-built PS4 RPF archives; it does not convert PC RPF/YFT/YTD/YFT assets.",
      "The user attested that source archives are PS4-target resources and that /app0 destinations match this exact title/update.",
      "AFR must be installed and enabled in GoldHEN before applying the overlay.",
      "Back up the original destination archive before copying any overlay.",
      "Story Mode only. Do not use online."
    ]
  };
  const seen = new Set();
  for (const file of files) {
    const path = String(file.path || file.name || "");
    if (!/\\.rpf$/i.test(path)) throw new Error(`Only complete .rpf archives can be staged by this first package builder: ${path || "(unnamed file)"}`);
    const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes || []);
    if (bytes.length < 4 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RPF7") {
      throw new Error(`${path} does not have an RPF7 header. It cannot be staged as a PS4 RPF overlay.`);
    }
    const destination = safeAppPath(mappings[path]);
    if (!destination.toLowerCase().endsWith(".rpf")) throw new Error(`AFR destination for ${path} must end in .rpf.`);
    const key = destination.toLowerCase();
    if (seen.has(key)) throw new Error(`Two source archives map to the same destination: /app0/${destination}`);
    seen.add(key);
    const digest = await sha256(bytes);
    const stagingPath = `data/GoldHEN/AFR/${target.titleId}/${destination}`;
    zip.file(stagingPath, bytes);
    manifest.entries.push({ sourcePath: path, destination: `/app0/${destination}`, stagingPath: `/${stagingPath}`, bytes: bytes.length, sha256: digest, status: "staged-unchanged-ps4-rpf" });
  }
  const pluginIni = `; AutoPort AFR overlay — merge into your existing plugins.ini; do not replace the file.\n[${target.titleId}]\n/data/GoldHEN/plugins/afr.prx=true\n`;
  zip.file("plugins.ini.snippet", pluginIni);
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("README-INSTALL.txt", [
    "GTAV AutoPort — GoldHEN AFR handoff",
    `Target: ${target.titleId} / GTA V ${target.updateVersion} / ${target.mode}`,
    "",
    "1. Back up the original RPF archive(s) on the PS4.",
    "2. Confirm GoldHEN AFR is installed at /data/GoldHEN/plugins/afr.prx.",
    "3. Merge plugins.ini.snippet into /data/GoldHEN/plugins.ini; preserve existing entries.",
    `4. Copy the contents of data/GoldHEN/AFR/${target.titleId}/ to /data/GoldHEN/AFR/${target.titleId}/ on the PS4.`,
    "5. Reboot/relaunch as required by your GoldHEN setup and test Story Mode.",
    "",
    "IMPORTANT: This is a staging package, not a PC-to-PS4 converter. Only use it with RPF archives already built for the exact PS4 target and verified /app0 paths. It does not decrypt, rebuild, or convert PC game resources."
  ].join("\n"));
  return { blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), manifest };
}
