const MAX_BYTES = 64 * 1024;
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".ini", ".cfg"]);

function decodeText(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder("utf-16le").decode(data.subarray(2));
  if (data[0] === 0xfe && data[1] === 0xff) {
    const swapped = new Uint8Array(data.length - 2);
    for (let i = 2; i + 1 < data.length; i += 2) {
      swapped[i - 2] = data[i + 1];
      swapped[i - 1] = data[i];
    }
    return new TextDecoder("utf-16le").decode(swapped);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(data);
}

/** Decode small mod documentation as inert text; never execute commands or install steps. */
export function inspectModDocumentation(files = []) {
  return files.filter((file) => {
    const name = file.path.split("/").at(-1);
    const dot = name.lastIndexOf(".");
    return dot > 0 && TEXT_EXTENSIONS.has(name.slice(dot).toLowerCase());
  }).map((file) => {
    const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes || []);
    const text = decodeText(bytes);
    const truncated = new TextEncoder().encode(text).byteLength > MAX_BYTES;
    const preview = truncated ? text.slice(0, MAX_BYTES) : text;
    const pathHints = [...new Set((preview.match(/(?:[A-Za-z]:\\|\.\.\\|\.\.\/|dlcpacks?[/\\][^\s"'<>]+)/gi) || []).slice(0, 40))];
    const commandHints = [...new Set((preview.match(/\b(?:copy|replace|delete|install|extract|openiv|mods folder|update\.rpf|dlc\.rpf|dlcpack)\b/gi) || []).map((value) => value.toLowerCase()))];
    return {
      path: file.path,
      bytes: bytes.byteLength,
      encoding: bytes[0] === 0xff && bytes[1] === 0xfe ? "UTF-16 LE" : bytes[0] === 0xfe && bytes[1] === 0xff ? "UTF-16 BE" : "UTF-8 / compatible",
      preview,
      truncated,
      pathHints,
      commandHints,
      status: "read-only-text-review",
    };
  });
}
