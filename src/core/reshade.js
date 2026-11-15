const TEXT_EXTENSIONS = new Set([".fx", ".fxh", ".hlsl", ".ini", ".txt", ".md", ".cfg"]);
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
function extension(path = "") { const name = path.split("/").at(-1); const i = name.lastIndexOf("."); return i > 0 ? name.slice(i).toLowerCase() : ""; }
function decodeText(file) { const bytes = file?.bytes; if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_TEXT_BYTES) return ""; return new TextDecoder("utf-8", { fatal: false }).decode(bytes); }
const unique = (values) => [...new Set(values)];
export function inspectReshadeMod(files = []) {
  const sources = files.filter((file) => TEXT_EXTENSIONS.has(extension(file.path))).map((file) => ({ path: file.path, text: decodeText(file) }));
  const combined = sources.map((item) => item.text).join("\n");
  const fxFiles = sources.filter((item) => [".fx", ".fxh", ".hlsl"].includes(extension(item.path)));
  const iniFiles = sources.filter((item) => extension(item.path) === ".ini");
  const dlls = files.filter((file) => [".dll", ".addon64", ".addon"].includes(extension(file.path)));
  const techniques = unique([...combined.matchAll(/\btechnique(?:10|11)?\s+([A-Za-z_]\w*)/g)].map((m) => m[1]));
  const includes = unique([...combined.matchAll(/^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm)].map((m) => m[1]));
  const uniforms = unique([...combined.matchAll(/\buniform\s+(?:\w+\s+)+([A-Za-z_]\w*)\s*(?:<|[;=])/g)].map((m) => m[1]));
  const markers = [
    ["depth-buffer", /depth\s*buffer|\bdepthbuffer\b|\bdepth\b/i],
    ["ambient-occlusion", /\b(mxao|ambient\s*occlusion|ssao)\b/i],
    ["ray-tracing-or-gi", /\b(rtgi|ray\s*trac(?:e|ing)|global\s*illumination)\b/i],
    ["screen-space-reflections", /\b(ssr|screen\s*space\s*reflection)\b/i],
    ["temporal-or-motion-data", /\b(motion\s*vector|temporal\s*aa|taa|velocity\s*buffer)\b/i],
    ["bloom", /\bbloom\b/i], ["tone-mapping", /\b(tone.?map|tonemap|exposure|color.?grade|colour.?grade)\b/i],
    ["sharpening", /\b(sharpen|cas|luma.?sharpen)\b/i], ["color-adjustment", /\b(vibrance|saturation|contrast|gamma|lift.?gamma.?gain)\b/i],
    ["depth-of-field", /\b(depth.?of.?field|\bdof\b|bokeh)\b/i],
  ];
  const detectedEffects = markers.filter(([, pattern]) => pattern.test(combined)).map(([name]) => name);
  const missingIncludes = includes.filter((include) => !files.some((file) => file.path.toLowerCase().endsWith(include.toLowerCase().replaceAll("\\", "/"))));
  const requirements = [];
  if (dlls.length) requirements.push("Windows ReShade/add-on binaries are not executable on PS4 and must not be packaged as PS4 payloads.");
  if (includes.length) requirements.push("Resolve every shader include before attempting a source-level translation.");
  if (detectedEffects.some((name) => ["depth-buffer", "ambient-occlusion", "ray-tracing-or-gi", "screen-space-reflections", "temporal-or-motion-data", "depth-of-field"].includes(name))) requirements.push("Depth-, ray-tracing-, reflection-, temporal- or DOF-dependent effects need game-renderer data/hooks; a simple preset or timecycle edit cannot reproduce them.");
  if (detectedEffects.some((name) => ["bloom", "tone-mapping", "sharpening", "color-adjustment"].includes(name))) requirements.push("Some color/post-process effects may be approximated through GTA V-native visual settings or a verified PS4 shader hook, but require visual comparison on the exact game build.");
  if (!fxFiles.length) requirements.push("No ReShade .fx/.fxh/HLSL source was found; a preset INI alone generally contains parameter values, not the shader implementation.");
  return { schemaVersion: 1, detected: Boolean(fxFiles.length || iniFiles.length || dlls.length || /reshade/i.test(combined)),
    files: { effects: fxFiles.map((x) => x.path), presets: iniFiles.map((x) => x.path), pcBinaries: dlls.map((x) => x.path) },
    techniques, includes, uniforms, detectedEffects, missingIncludes, requirements,
    summary: { sourceFiles: fxFiles.length, presetFiles: iniFiles.length, pcBinaries: dlls.length, techniques: techniques.length, includes: includes.length, detectedEffectFamilies: detectedEffects.length },
    status: "analysis-only", ps4PackageReady: false,
    note: "Static source inspection only. No HLSL compilation, shader replacement, PS4 renderer hook, or target-build validation has occurred." };
}
