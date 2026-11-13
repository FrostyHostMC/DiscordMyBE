const MAGIC = [0x52, 0x53, 0x43, 0x37];
const FIXTURE_VERSIONS = {
  ".yft": [162],
  ".ytd": [13],
};

export function inspectRsc7(bytes, path = "") {
  const extension = path.toLowerCase().slice(path.lastIndexOf("."));
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 16) {
    return { valid: false, status: "invalid", reason: "File is shorter than the 16-byte RSC7 header." };
  }
  if (!MAGIC.every((value, index) => bytes[index] === value)) {
    return { valid: false, status: "not-rsc7", reason: "RSC7 magic was not found." };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  const systemFlags = view.getUint32(8, true);
  const graphicsFlags = view.getUint32(12, true);
  const fixtureVersionMatch = FIXTURE_VERSIONS[extension]?.includes(version) ?? false;

  return {
    valid: true,
    status: "rsc7",
    magic: "RSC7",
    headerSize: 16,
    version,
    systemFlags,
    graphicsFlags,
    fixtureVersionMatch,
    extension,
    platform: "undetermined",
    payloadBytes: bytes.byteLength - 16,
    notes: [
      "The RSC7 signature and version identify a resource container, not its target console.",
      "Fixture-version matching only compares the header version with the supplied Glendale PC sample.",
      "Page flags are recorded but not yet decoded or validated.",
      "No decompression, pointer traversal, model parsing, or platform conversion is performed.",
    ],
  };
}
