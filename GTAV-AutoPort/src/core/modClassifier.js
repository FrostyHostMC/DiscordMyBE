import { inspectExecutableHeader } from "./executableInspector.js";
import { inspectBinaryFormat } from "./defaultFormatAdapters.js";

const EXTENSIONS = {
  ".rpf": ["archive", "RAGE archive", "archive-adapter-required"],
  ".fx": ["reshade-shader", "ReShade HLSL effect source", "ps4-renderer-adaptation-required"],
  ".fxh": ["reshade-shader-include", "ReShade HLSL include", "shader-dependency-resolution-required"],
  ".hlsl": ["shader-source", "HLSL shader source", "ps4-renderer-adaptation-required"],
  ".gfx": ["scaleform-graphics", "Scaleform GFx movie", "scaleform-runtime-validation-required"],
  ".swf": ["scaleform-graphics", "Flash / Scaleform source movie", "scaleform-export-required"],
  ".fla": ["scaleform-source", "Flash authoring project", "scaleform-authoring-required"],
  ".as": ["scaleform-source", "ActionScript source", "scaleform-authoring-required"],
  ".ttf": ["font-source", "TrueType font", "scaleform-font-export-required"],
  ".otf": ["font-source", "OpenType font", "scaleform-font-export-required"],
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
  if (!bytes) return null;
  const result = inspectBinaryFormat({ path: "", bytes });
  return result.signature;
}

function extensionOf(file) {
  if (file.extension) return file.extension.toLowerCase();
  const name = String(file.path || "").split(/[\\/]/).at(-1).toLowerCase();
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index) : "";
}

function classifyOne(file) {
  const extension = extensionOf(file);
  const extensionHint = EXTENSIONS[extension] || null;
  const formatDetection = file.bytes instanceof Uint8Array
    ? inspectBinaryFormat(file)
    : { status: "unrecognized", selectedAdapterId: null, candidates: [], probeErrors: [], preservedAsSource: true, conversionAuthorized: false, signature: null };
  const signature = signatureOf(file.bytes);
  const binaryInspection = /\\.(asi|dll|exe|sys|prx|sprx|elf)$/i.test(String(file.path || "")) ? inspectExecutableHeader(file.bytes) : null;
  const inferred = {
    "rage-resource": ["rage-resource", "RAGE resource (signature identified)", "inspection-required"],
    "rage-archive": ["archive", "RAGE archive (signature identified)", "archive-inspection-required"],
    texture: ["texture-source", "Texture container (signature identified)", "asset-adapter-required"],
    image: ["texture-source", "Image asset (signature identified)", "asset-adapter-required"],
    audio: ["audio-source", "Audio container (signature identified)", "asset-adapter-required"],
    "windows-executable": ["pc-native-plugin", "Windows executable (signature identified)", "not-directly-portable"],
    "native-elf-binary": ["native-binary", "ELF native binary (signature identified)", "platform-validation-required"]
  };
  const signatureHint = formatDetection.status === "recognized" ? inferred[formatDetection.match?.role] : null;
  const [family, label, portability] = extensionHint || signatureHint || ["unknown", "Unrecognized file", "unknown-review"];
  const classificationBasis = extensionHint ? "extension-hint" : signatureHint ? "content-signature" : "unknown";
  const warnings = [];
  if ([".asi", ".dll", ".exe", ".sys"].includes(extension) || (family === "pc-native-plugin" && signature === "MZ")) warnings.push("Windows/PC native code cannot be copied to PS4 as a working plugin.");
  if ([".gfx", ".swf", ".fla", ".as", ".ttf", ".otf"].includes(extension)) warnings.push("Scaleform graphics/font assets need a compatible GFx authoring/export workflow and an exact-build PS4 loader; file identification alone is not a playable graphics mod.");
  if (extension === ".prx" || extension === ".sprx") warnings.push("A PRX/SPRX is platform-native code; verify Orbis target, loader, title ID and exact game build.");
  if (binaryInspection?.format === "pe" && [".prx", ".sprx"].includes(extension)) warnings.push("Binary inspection found a Windows PE image inside a PRX/SPRX-named file; it is not a valid Orbis plugin candidate.");
  if (binaryInspection?.format === "elf" && binaryInspection.status === "header-inspected" && !binaryInspection.architectureCompatibleWithPs4Cpu) warnings.push("ELF machine/class/byte order does not match the expected PS4 x86-64 architecture.");
  if (binaryInspection?.format === "elf" && binaryInspection.status === "header-inspected" && binaryInspection.architectureCompatibleWithPs4Cpu) warnings.push("ELF CPU architecture matches x86-64, but Orbis ABI, SELF/PRX packaging, imports and game-build compatibility remain unverified.");
  if (binaryInspection?.format === "sce-container") warnings.push("Sony SCE container signature detected; signature, encryption, imports and target compatibility are not validated.");
  if (extension === ".ysc") warnings.push("Compiled game scripts require matching runtime/native compatibility and are not source-code translations.");
  if (family === "unknown") warnings.push("No adapter has been assigned. Preserve this file and inspect its content before deciding whether it is required.");
  if (signature === "MZ" && ![".dll", ".exe", ".asi"].includes(extension)) warnings.push("Detected a Windows PE executable signature despite the file extension.");
  if (signature && extensionHint) {
    const signatureRole = formatDetection.match?.role;
    const extensionFamily = extensionHint[0];
    const compatible = (signatureRole === "rage-resource" && extensionFamily === "rage-resource")
      || (signatureRole === "rage-archive" && extensionFamily === "archive")
      || (signatureRole === "texture" && extensionFamily === "texture-source")
      || (signatureRole === "image" && extensionFamily === "texture-source")
      || (signatureRole === "audio" && extensionFamily === "audio-source")
      || (signatureRole === "windows-executable" && extensionFamily === "pc-native-plugin")
      || (signatureRole === "native-elf-binary" && ["native-binary", "console-native-plugin"].includes(extensionFamily));
    if (!compatible) warnings.push("The detected binary signature does not agree with the file extension hint; inspect the file before selecting a converter.");
  }
  return { path: file.path, extension, size: file.size ?? file.bytes?.byteLength ?? 0, family, label, portability, classificationBasis, signature, formatDetection, binaryInspection, warnings };
}

export function auditModFiles(files = []) {
  const items = files.map(classifyOne);
  const counts = {};
  for (const item of items) counts[item.family] = (counts[item.family] || 0) + 1;
  const blockers = items.filter((item) => ["not-directly-portable", "platform-validation-required", "unknown-review", "behavior-reimplementation-required"].includes(item.portability));
  const warnings = items.flatMap((item) => item.warnings.map((message) => ({ path: item.path, message })));
  return { schemaVersion: 1, files: items, summary: { fileCount: items.length, totalBytes: items.reduce((sum, item) => sum + item.size, 0), familyCounts: counts, pcNativePlugins: items.filter((item) => item.family === "pc-native-plugin").length, scriptsNeedingReview: items.filter((item) => item.family === "script-source" || item.family === "game-script").length, unknownFiles: items.filter((item) => item.family === "unknown").length, attentionCount: blockers.length }, warnings, status: "analysis-only", note: "File-family detection is an intake audit, not proof that a resource is understood or PS4-convertible. Signature probes are intentionally conservative." };
}