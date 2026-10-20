/**
 * Central asset registry.
 *
 * Keeping the URLs in one module means a broken/rotated CDN link only has to be
 * fixed in a single place instead of being scattered across every screen.
 */

/** StoneByte brand mark (logo icon). */
export const IMAGE_DNFM =
  'https://cdn.aippy.ai/asset/96b93ca9650943c09e03b1f675001ac0.png?x-oss-process=style/p';

/** Dark nebula backdrop used on the splash / modpack details banner. */
export const IMAGE_SPLASH_BG =
  'https://cdn.aippy.ai/asset/ded715de6f58468487e7243e4e5b7060.jpg?x-oss-process=image/format,webp';

/** Inline fallback used when the remote logo cannot be loaded (offline / CSP). */
export const IMAGE_DNFM_FALLBACK =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#a855f7"/>
          <stop offset="100%" stop-color="#4c1d95"/>
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="28" fill="#07050F"/>
      <rect x="18" y="18" width="92" height="92" rx="22" fill="url(#g)" opacity="0.25"/>
      <text x="64" y="80" font-family="system-ui, sans-serif" font-size="52" font-weight="bold"
        fill="url(#g)" text-anchor="middle">SB</text>
    </svg>`
  );

const assetsData = {
  IMAGE_DNFM,
  IMAGE_SPLASH_BG,
  IMAGE_DNFM_FALLBACK
};

export default assetsData;