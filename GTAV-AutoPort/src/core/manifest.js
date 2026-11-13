async function sha256(buffer) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildConversionManifest({ sourceName, files, metadata, target = null, assetChecks = [] }) {
  const sourceFiles = [];
  for (const file of files) {
    sourceFiles.push({
      path: file.path,
      size: file.bytes.byteLength,
      sha256: await sha256(file.bytes),
    });
  }
  return {
    schemaVersion: 1,
    product: "GTAV AutoPort",
    status: "analysis-only",
    source: { name: sourceName, files: sourceFiles },
    conversion: metadata,
    assetChecks,
    target,
    gates: {
      archiveInspected: true,
      metadataParsed: Boolean(metadata),
      assetConversionImplemented: false,
      targetBuildValidated: false,
      deploymentReady: false,
    },
    createdAt: new Date().toISOString(),
  };
}
