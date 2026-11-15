/** Create a repeatable UUID for a generated pack/module from stable input identity. */
export function stableUUID(seed: string): string {
  const bytes = new TextEncoder().encode(seed);
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let i = 0; i < bytes.length; i++) {
    const lane = i % hashes.length;
    hashes[lane] = Math.imul(hashes[lane] ^ bytes[i], 0x01000193 + lane * 2) >>> 0;
    hashes[(lane + 1) % hashes.length] = (hashes[(lane + 1) % hashes.length] ^ (hashes[lane] >>> 13)) >>> 0;
  }
  const hex = hashes.map((value) => value.toString(16).padStart(8, '0')).join('').split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const raw = hex.join('');
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}