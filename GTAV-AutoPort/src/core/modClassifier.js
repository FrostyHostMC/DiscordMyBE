const EXTENSIONS = {
  ".rpf": ["archive", "RAGE archive", "archive-adapter-required"],
  ".yft": ["rage-resource", "RAGE fragment", "source-parser-available"],
  ".ydr": ["rage-resource", "RAGE drawable", "source-parser-available"],
  ".ydd": ["rage-resource", "RAGE drawable dictionary", "source-parser-available"],
  ".ytd": ["rage-resource", "RAGE texture dictionary", "source-parser-available"],
  ".ybn": ["rage-resource", "RAGE collision", "source-parser-available"],
  ".ymap": ["rage-resource", "RAGE map placement", "source-parser-available"],
  ".ytyp": ["rage-resource", "RAGE archetype", "source-parser-available"],
  ".ymf": ["rage-resource", "RAGE manifest", "source-parser-available"],
  ".ymt": ["rage-resource", "RAGE metadata", "source-parser-available"],
  ".ycd": ["rage-resource", "RAGE animation dictionary", "source-parser-available"],
  ".ypt": ["rage-resource", "RAGE particle effects", "source-parser-available"],
  ".ynd": ["rage-resource", "RAGE path nodes", "source-parser-available"],
  ".ynv": ["rage-resource", "RAGE navigation mesh", "source-parser-available"],
  ".ysc": ["game-script", "Compiled GTA script", "runtime-adaptation-required"],
  ".awc": ["audio-resource", "RAGE audio container", "source-parser-candidate"],
  ".rel": ["audio-resource", "RAGE audio metadata", "source-parser-candidate"],
  ".gxt2": ["text-resource", "RAGE text table", "source-parser-candidate"],
  ".cut": ["scene-resource", "RAGE cutscene", "source-parser-candidate"],
  ".meta": ["metadata", "GTA metadata", "metadata-adapter-required"],
  ".xml": ["metadata", "XML configuration/metadata", "metadata-adapter-required"],
  ".ini": ["configuration", "INI configuration", "configuration-review"],
  ".cfg": ["configuration", "Configuration", "configuration-review"],
  ".txt": ["documentation", "Mod documentation / instructions", "manual-review"],
  ".md": ["documentation", "Markdown documentation", "manual-review"],
  ".json": ["configuration", "JSON configuration/manifest", "configuration-review"],
  ".toml": ["configuration", "TOML configuration", "configuration-review"],
  ".lua": ["script-source", "Lua script", "behavior-reimplementation-required"],
  ".cs": ["script-source", "C# script", "behavior-reimplementation-required"],
  ".js": ["script-source", "JavaScript script", "behavior-reimplementation-required"],
  ".py": ["script-source", "Python script", "behavior-reimplementation-required"],
  ".asi": ["pc-native-plugin", "ASI plugin", "not-directly-portable"],
  ".dll": ["pc-native-plugin", "Windows DLL / .NET assembly", "not-directly-portable"],
  ".exe": ["pc-native-plugin", "Windows executable", "not-directly-portable"],
  ".sys": ["pc-native-plugin", "Windows driver", "not-directly-portable"],
  ".prx": ["console-native-plugin", "Console PRX plugin", "target-build-validation-required"],
  ".elf": ["native-binary", "ELF executable/module", "platform-validation-required"],
  ".fbx": ["3d-source", "FBX model source", "asset-adapter-required"],
  ".obj": ["3d-source", "Wavefront OBJ model source", "asset-adapter-required"],
  ".dae": ["3d-source", "Collada model source", "asset-adapter-required"],
  ".gltf": ["3d-source", "glTF model source", "asset-adapter-required"],
  ".glb": ["3d-source", "Binary glTF model source", "asset-adapter-required"],
  ".blend": ["3d-source", "Blender project", "asset-adapter-required"],
  ".png": ["texture-source", "PNG image", "asset-adapter-required"],
  ".jpg": ["texture-source", "JPEG image", "asset-adapter-required"],
  ".jpeg": ["texture-source", "JPEG image", "asset-adapter-required"],
  ".dds": ["texture-source", "DDS texture", "asset-adapter-required"],
  ".tga": ["texture-source", "TGA image", "asset-adapter-required"],
  ".bmp": ["texture-source", "Bitmap image", "asset-adapter-required"],
  ".wav": ["audio-source", "WAV audio", "asset-adapter-required"],
  ".mp3": ["audio-source", "MP3 audio", "asset-adapter-required"],
  ".ogg": ["audio-source", "Ogg audio", "asset-adapter-required"],
  ".flac": ["audio-source", "FLAC audio", "asset-adapter-required"],
};

function signatureOf(bytes) {
  if (!bytes || bytes.length < 4) return null;
  const ascii = String.fromCharCode(...bytes.subarray(0, 4));
  if (ascii === "RSC7") return "RSC7";
  if (ascii === "RPF7") return "RPF7";
  if (ascii === "DDS ") return "DDS";
  if (ascii === "OggS") return "OGG";
  if (ascii === "RIFF" && bytes.length >= 12 && String.fromCharCode(...bytes.subarray(8, 12)) === "WAVE") return "WAVE";
  if (bytes[0] === 0x89 && ascii.slice(1, 4) === "PNG") return "PNG";
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) return "MZ";
  if (bytes[0] === 0x7f && ascii.slice(1, 4) === "ELF") return "ELF";
  return null;
}

function extensionOf(file) {
  if (file.extension) return file.extension.toLowerCase();
  const name = file.path.split("/").at(-1).toLowerCase();
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index) : "";
}

function classifyOne(file) {
  const extension = extensionOf(file);
  const [family, label, portability] = EXTENSIONS[extension] || ["unknown", "Unrecognized file", "unknown-review"];
  const signature = signatureOf(file.bytes);
  const warnings = [];
  if ([".asi", ".dll", ".exe", ".sys"].includes(extension)) warnings.push("Windows/PC native code cannot be copied to PS4 as a working plugin.");
  if (extension === ".prx") warnings.push("A PRX is platform-native code; verify Orbis target, loader, title ID and exact game build.");
  if (extension === ".ysc") warnings.push("Compiled game scripts require matching runtime/native compatibility and are not source-code translations.");
  if (family === "unknown") warnings.push("No adapter has been assigned. Preserve this file and inspect its content before deciding whether it is required.");
  if (signature === "MZ" && ![".dll", ".exe", ".asi"].includes(extension)) warnings.push("Detected a Windows PE executable signature despite the file extension.");
  return { path: file.path, extension, size: file.size ?? file.bytes?.byteLength ?? 0, family, label, portability, signature, warnings };
}

export function auditModFiles(files = []) {
  const items = files.map(classifyOne);
  const counts = {};
  for (const item of items) counts[item.family] = (counts[item.family] || 0) + 1;
  const blockers = items.filter((item) => ["not-directly-portable", "platform-validation-required", "unknown-review", "behavior-reimplementation-required"].includes(item.portability));
  const warnings = items.flatMap((item) => item.warnings.map((message) => ({ path: item.path, message })));
  return { schemaVersion: 1, files: items, summary: { fileCount: items.length, totalBytes: items.reduce((sum, item) => sum + item.size, 0), familyCounts: counts, pcNativePlugins: items.filter((item) => item.family === "pc-native-plugin").length, scriptsNeedingReview: items.filter((item) => item.family === "script-source" || item.family === "game-script").length, unknownFiles: items.filter((item) => item.family === "unknown").length, attentionCount: blockers.length }, warnings, status: "analysis-only", note: "File-family detection is an intake audit, not proof that a resource is understood or PS4-convertible. Signature probes are intentionally conservative." };
}