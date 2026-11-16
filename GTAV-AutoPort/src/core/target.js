const COMMON_TARGET = Object.freeze({
  platform: "PlayStation 4",
  systemFirmware: "14.00",
  systemFirmwareSource: "user-confirmed",
  goldhenVersion: "2.4b18.13",
  goldhenVersionSource: "user-confirmed",
  game: "Grand Theft Auto V",
  updateVersion: "1.57",
  mode: "Story Mode",
  source: "user-confirmed",
  verifiedAgainstConsole: false,
  resourceCompatibility: "unverified",
});
export const PS4_TARGETS = Object.freeze({
  CUSA00419: Object.freeze({ ...COMMON_TARGET, titleId: "CUSA00419", region: "US", contentId: "UP1004-CUSA00419_00-GTAVDIGITALDOWNL", publisherId: "UP1004" }),
  CUSA00411: Object.freeze({ ...COMMON_TARGET, titleId: "CUSA00411", region: "EU", contentId: null, publisherId: null }),
});
export const PS4_TARGET = PS4_TARGETS.CUSA00419;

export function resolvePs4Target({ titleId, updateVersion } = {}) {
  const normalizedTitleId = String(titleId || "").trim().toUpperCase();
  const profile = PS4_TARGETS[normalizedTitleId];
  if (!profile) return {
    status: "unsupported-title", target: null, detectedTitleId: normalizedTitleId || null,
    detectedUpdateVersion: updateVersion == null ? null : String(updateVersion),
    reason: normalizedTitleId ? `Title ID ${normalizedTitleId} is not a supported Project V target.` : "A title ID is required; no regional profile can be selected safely.",
  };
  const detectedVersion = normalizeUpdateVersion(updateVersion);
  if (detectedVersion && detectedVersion !== profile.updateVersion) return {
    status: "unsupported-update", target: profile, detectedTitleId: normalizedTitleId,
    detectedUpdateVersion: detectedVersion, reason: `Detected GTA V update ${detectedVersion}; this profile is for ${profile.updateVersion}.`,
  };
  return {
    status: detectedVersion ? "matched" : "title-matched-version-unconfirmed",
    target: profile, detectedTitleId: normalizedTitleId, detectedUpdateVersion: detectedVersion,
    reason: detectedVersion ? `Matched ${profile.region} title ID and GTA V ${profile.updateVersion} metadata.` : `Matched ${profile.region} title ID. Update version was not present in the readable evidence.`,
  };
}
export function normalizeUpdateVersion(value) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  const match = raw.match(/^(?:0?1\.)?(\d{1,3})(?:\.\d+)?$/);
  return match ? `1.${Number(match[1])}` : raw;
}
export function describeTarget(target = PS4_TARGET) {
  return `${target.titleId} · GTA V ${target.updateVersion} · ${target.mode}`;
}
