export const PS4_TARGET = Object.freeze({
  platform: "PlayStation 4",
  systemFirmware: "14.00",
  systemFirmwareSource: "user-confirmed",
  goldhenVersion: "2.4b18.13",
  goldhenVersionSource: "user-confirmed",
  titleId: "CUSA00411",
  game: "Grand Theft Auto V",
  updateVersion: "1.73",
  mode: "Story Mode",
  source: "user-confirmed",
  verifiedAgainstConsole: false,
  resourceCompatibility: "unverified",
});

export function describeTarget(target = PS4_TARGET) {
  return `${target.titleId} · GTA V ${target.updateVersion} · ${target.mode}`;
}
