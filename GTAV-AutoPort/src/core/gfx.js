const SIGNATURES = Object.freeze({
  FWS: { format: "SWF", compression: "none", scaleform: false, editableHeader: "FWS" },
  CWS: { format: "SWF", compression: "zlib", scaleform: false, editableHeader: "CWS" },
  ZWS: { format: "SWF", compression: "lzma", scaleform: false, editableHeader: "ZWS" },
  GFX: { format: "Scaleform GFX", compression: "none", scaleform: true, editableHeader: "FWS" },
  CFX: { format: "Scaleform GFX", compression: "zlib", scaleform: true, editableHeader: "CWS" },
});

const MAX_SCALEFORM_BYTES = 512 * 1024 * 1024;

function readU32LE(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

/**
 * Read-only Scaleform/SWF header inspection. Compressed payloads are not
 * decompressed or executed. Header conversion is only for editor handoff.
 */
export function inspectScaleformAsset(file) {
  const bytes = file?.bytes instanceof Uint8Array ? file.bytes : new Uint8Array();
  const signature = bytes.length >= 3 ? String.fromCharCode(bytes[0], bytes[1], bytes[2]) : "";
  const descriptor = SIGNATURES[signature] || null;
  const declaredLength = bytes.length >= 8 ? readU32LE(bytes, 4) : null;
  const version = bytes.length >= 4 ? bytes[3] : null;
  const errors = [];

  if (!descriptor) errors.push("Unrecognized Scaleform/SWF signature. Expected FWS, CWS, ZWS, GFX or CFX.");
  if (bytes.length < 8) errors.push("File is shorter than the 8-byte SWF header.");
  if (descriptor && declaredLength !== null && declaredLength < 8) errors.push("Declared uncompressed file length is smaller than the SWF header.");
  if (descriptor && declaredLength !== null && declaredLength > MAX_SCALEFORM_BYTES) errors.push("Declared uncompressed length exceeds the 512 MiB safety limit.");
  if (descriptor && declaredLength !== null && descriptor.compression === "none" && declaredLength !== bytes.length) {
    errors.push("Uncompressed header length does not match the actual file size.");
  }

  const validHeader = Boolean(descriptor && bytes.length >= 8 && errors.length === 0);
  return {
    path: file?.path || "unnamed",
    extension: file?.extension || "",
    signature: descriptor ? signature : (signature || "unknown"),
    format: descriptor?.format || "unknown",
    compression: descriptor?.compression || "unknown",
    scaleform: Boolean(descriptor?.scaleform),
    version,
    declaredUncompressedBytes: declaredLength,
    actualBytes: bytes.length,
    validHeader,
    payloadVerified: false,
    editableSwfCopyAvailable: validHeader && Boolean(descriptor?.scaleform),
    errors,
    note: validHeader
      ? "Header is structurally plausible. The compressed movie body, ActionScript, embedded assets and GTA V runtime compatibility have not been validated."
      : "This file is not cleared for editing or deployment. Preserve the original and inspect the reported header errors.",
  };
}

/** Convert only the 3-byte GFX/CFX signature for a JPEXS editor handoff copy. */
export function createEditableSwfCopy(file) {
  const bytes = file?.bytes instanceof Uint8Array ? file.bytes : null;
  if (!bytes) throw new Error("A loaded Scaleform file is required.");
  const report = inspectScaleformAsset(file);
  if (!report.validHeader || !report.scaleform) {
    throw new Error("Only a structurally valid GFX/CFX file can be prepared as an editor handoff copy.");
  }
  const output = bytes.slice();
  const targetSignature = report.signature === "CFX" ? "CWS" : "FWS";
  output.set([...targetSignature].map((character) => character.charCodeAt(0)), 0);
  const base = String(file.path || "scaleform").split("/").at(-1).replace(/\.(gfx|swf)$/i, "");
  return {
    filename: `${base || "scaleform"}-editor-copy.swf`,
    bytes: output,
    sourceSignature: report.signature,
    outputSignature: targetSignature,
    warning: "Editor handoff only. This copy is not a game-ready GFX build; use a compatible Scaleform GFx export pipeline and validate the target runtime.",
  };
}

export function inspectScaleformAssets(files = []) {
  const candidates = files.filter((file) => /\.(gfx|swf)$/i.test(file.path || ""));
  const reports = candidates.map(inspectScaleformAsset);
  return {
    schemaVersion: 1,
    reports,
    summary: {
      files: reports.length,
      validHeaders: reports.filter((item) => item.validHeader).length,
      scaleformGfx: reports.filter((item) => item.scaleform).length,
      swf: reports.filter((item) => item.format === "SWF").length,
      invalid: reports.filter((item) => !item.validHeader).length,
      payloadsVerified: 0,
      ps4Compatible: false,
    },
    limitations: [
      "Header inspection does not decompile or validate the Scaleform movie body.",
      "Changing GFX/CFX to FWS/CWS is only an editor handoff; it does not compile a game-ready GFX file.",
      "A game-ready Scaleform GFX build normally requires a compatible GFxExport toolchain.",
      "The public PS4 GTA V GFX Loader inspected by AutoPort hard-codes a GTA V 1.46 hook and is not validated for GTA V 1.73.",
    ],
  };
}
