import { convertLegacyResourceCandidate } from "./resourceConversion.js";
import { defaultFormatAdapterRegistry } from "./defaultFormatAdapters.js";

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
      confidence: 0.95,
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
