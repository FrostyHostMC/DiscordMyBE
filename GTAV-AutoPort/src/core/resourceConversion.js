function encode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  return btoa(binary);
}
export async function convertLegacyResourceCandidate(file) {
  const extension = file.path.slice(file.path.lastIndexOf(".")).toLowerCase();
  if (![".yft", ".ytd", ".ydr", ".ydd", ".ybn"].includes(extension)) throw new Error("Only YFT, YTD, YDR, YDD and YBN resources can be converted by this adapter.");
  const response = await fetch("/__autoport/convert-legacy-resource", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.path, data: encode(file.bytes) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Legacy resource conversion failed.");
  const binary = atob(result.outputBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { ...result, bytes };
}
