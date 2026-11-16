import { convertLegacyResourceCandidate } from "./resourceConversion.js";
import { defaultFormatAdapterRegistry } from "./defaultFormatAdapters.js";
import { convertDdsToPs4TextureStorage } from "./ps4TextureLayout.js";

const PC_LEGACY_RESOURCE_EXTENSIONS = new Set([".yft", ".ydr", ".ydd", ".ytd"]);

defaultFormatAdapterRegistry.register({
  id: "ragekit-pc-legacy-resource-writer",
  version: "ragekit-adapter-v1",
  description: "RageKit PC Legacy resource rewrite with output round-trip verification",
  capabilities: ["identify", "convert", "roundtrip-verify"],
  priority: 10,
  probe(file) {
    if (!PC_LEGACY_RESOURCE_EXTENSIONS.has(file.extension)) return { match: false };
    return {
      match: true,
      confidence: 1,
      role: "rage-resource",
      evidence: ["RageKit PC Legacy writer supports this RAGE resource family", "format-specific writer will validate the actual resource"],
      capabilities: ["convert", "roundtrip-verify"]
    };
  },
  async convert(file) {
    const result = await convertLegacyResourceCandidate(file);
    return {
      ...result,
      targetCompatibility: "GTA V PC Legacy only; Orbis/PS4 not validated",
      installable: false
    };
  }
});

export const registeredFormatAdapterRegistry = defaultFormatAdapterRegistry;


defaultFormatAdapterRegistry.register({
  id: "ps4-thin1dthin-dds-storage",
  version: "experimental-v1",
  description: "Experimental PS4 Legacy BC1/BC3/BC5 DDS storage-layout conversion",
  capabilities: ["identify", "convert", "roundtrip-verify", "ps4-texture-storage"],
  priority: 20,
  probe(file) {
    const bytes = file.bytes;
    if (bytes.length < 4 || bytes[0] !== 0x44 || bytes[1] !== 0x44 || bytes[2] !== 0x53 || bytes[3] !== 0x20) {
      return { match: false };
    }
    return {
      match: true,
      confidence: 1,
      role: "ps4-texture-storage-candidate",
      evidence: ["DDS magic at offset 0", "full mip payload validation deferred to the converter"],
      capabilities: ["convert", "roundtrip-verify", "ps4-texture-storage"]
    };
  },
  convert(file) {
    const result = convertDdsToPs4TextureStorage(file.bytes);
    if (result.status !== "ps4-texture-storage-candidate") {
      throw new Error(result.inspection?.error || "DDS is not supported by the experimental PS4 texture storage adapter.");
    }
    return {
      bytes: result.storage,
      layout: result.layout,
      inspection: result.inspection,
      roundtripVerified: result.roundTripVerified,
      targetCompatibility: result.targetCompatibility,
      installable: false
    };
  }
});
