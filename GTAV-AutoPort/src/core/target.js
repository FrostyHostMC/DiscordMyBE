const COMMON_TARGET = Object.freeze({
  platform: "PlayStation 4",
  game: "Grand Theft Auto V",
  updateVersion: "1.57",
  mode: "Story Mode",
  resourceCompatibility: "unverified",
  verifiedAgainstConsole: false,
});

// The US profile is the user's recorded target. The EU profile is included as a
// supported identification target, but its executable/resource compatibility
// remains unverified. Do not infer one region's executable offsets from the other.
export const PS4_TARGETS = Object.freeze({
  CUSA00419: Object.freeze({
    ...COMMON_TARGET,
    titleId: "CUSA00419",
    region: "US",
    contentId: "UP1004-CUSA00419_00-GTAVDIGITALDOWNL",
    publisherId: "UP1004",
    systemFirmware: "14.00",
    systemFirmwareSource: "user-confirmed",
    goldhenVersion: "2.4b18.13",
    goldhenVersionSource: "user-confirmed",
    source: "user-confirmed",
  }),
  CUSA00411: Object.freeze({
    ...COMMON_TARGET,
    titleId: "CUSA00411",
    region: "EU",
    contentId: null,
    publisherId: null,
    source: "research-reference",
  }),
});

export const PS4_TARGET = PS4_TARGETS.CUSA00419;
export const SUPPORTED_TITLE_IDS = Object.freeze(Object.keys(PS4_TARGETS));

export function resolveTargetByTitleId(titleId) {
  if (typeof titleId !== "string") return null;
  return PS4_TARGETS[titleId.trim().toUpperCase()] ?? null;
}

export function describeTarget(target = PS4_TARGET) {
  return `${target.titleId} · GTA V ${target.updateVersion} · ${target.mode}`;
}
