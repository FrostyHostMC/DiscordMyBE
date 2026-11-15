import { FormatAdapterRegistry } from "./formatAdapterRegistry.js";

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function exact(bytes, expected) {
  return bytes.length >= expected.length && expected.every((value, index) => bytes[index] === value);
}

const signatureAdapters = [
  { id: "rage-rsc7", description: "RAGE resource container", capabilities: ["identify", "inspect"], probe: ({ bytes }) => exact(bytes, [0x52, 0x53, 0x43, 0x37]) ? { match: true, confidence: 1, role: "rage-resource", evidence: ["RSC7 magic at offset 0"] } : null },
  { id: "rage-rpf7", description: "RAGE RPF7 archive", capabilities: ["identify", "inspect"], probe: ({ bytes }) => exact(bytes, [0x37, 0x46, 0x50, 0x52]) ? { match: true, confidence: 1, role: "rage-archive", evidence: ["Little-endian RPF7 magic at offset 0"] } : null },
  { id: "dds", description: "DirectDraw Surface image", capabilities: ["identify"], probe: ({ bytes }) => ascii(bytes, 0, 4) === "DDS " ? { match: true, confidence: 1, role: "texture", evidence: ["DDS header"] } : null },
  { id: "png", description: "PNG image", capabilities: ["identify"], probe: ({ bytes }) => exact(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? { match: true, confidence: 1, role: "image", evidence: ["PNG signature"] } : null },
  { id: "wave", description: "RIFF WAVE audio", capabilities: ["identify"], probe: ({ bytes }) => bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE" ? { match: true, confidence: 1, role: "audio", evidence: ["RIFF container with WAVE form type"] } : null },
  { id: "ogg", description: "Ogg container", capabilities: ["identify"], probe: ({ bytes }) => ascii(bytes, 0, 4) === "OggS" ? { match: true, confidence: 1, role: "audio-or-media-container", evidence: ["OggS capture pattern"] } : null },
  { id: "windows-pe", description: "Windows Portable Executable", capabilities: ["identify"], probe: ({ bytes }) => exact(bytes, [0x4d, 0x5a]) ? { match: true, confidence: 1, role: "windows-executable", evidence: ["MZ DOS header signature"] } : null },
  { id: "elf", description: "ELF executable or shared object", capabilities: ["identify"], probe: ({ bytes }) => exact(bytes, [0x7f, 0x45, 0x4c, 0x46]) ? { match: true, confidence: 1, role: "native-elf-binary", evidence: ["ELF magic"] } : null }
];

export const DEFAULT_FORMAT_ADAPTERS = Object.freeze(signatureAdapters.map(({ id, description, capabilities, probe }) => Object.freeze({ id, description, capabilities, probe })));
export const defaultFormatAdapterRegistry = new FormatAdapterRegistry(DEFAULT_FORMAT_ADAPTERS);

export function inspectBinaryFormat(file) {
  const result = defaultFormatAdapterRegistry.inspect(file);
  return {
    ...result,
    signature: result.status === "recognized" ? result.selectedAdapterId : null
  };
}
