import { createHash } from "node:crypto";

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function buildConversionManifest({ sourceName, files, metadata, target }) {
  return {
    schemaVersion: 1,
    product: "GTAV AutoPort",
    status: "analysis-only",
    source: {
      name: sourceName,
      files: files.map((file) => ({
        path: file.path,
        size: file.bytes.byteLength,
        sha256: sha256(file.bytes),
      })),
    },
    conversion: metadata,
    target: target ?? null,
    gates: {
      metadataParsed: true,
      assetConversionImplemented: false,
      targetBuildValidated: false,
      deploymentReady: false,
    },
    createdAt: new Date().toISOString(),
  };
}
