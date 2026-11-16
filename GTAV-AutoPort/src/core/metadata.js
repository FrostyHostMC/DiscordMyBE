import { XMLParser, XMLValidator } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === "Item",
});

const VEHICLE_FIELD_GROUPS = Object.freeze({
  identity: ["modelName", "txdName", "handlingId", "gameName", "vehicleMakeName", "vehicleClass", "type", "plateType", "vehicleType", "layout", "wheelType", "dashboardType", "displayName", "name", "vehicleClass"],
  audio: ["audioNameHash"],
  camera: ["cameraName", "cameraHash", "firstPersonDrivebyData", "aimCameraName", "bonnetCameraName", "povCameraName"],
  layoutAndAnimation: ["animConvRoofDictName", "animConvRoofName", "animConvRoofWindowsAffected", "expressionDictName", "expressionName", "coverBoundOffsets", "bonnetCameraName", "povCameraName"],
  appearanceAndEquipment: ["flags", "vehicleFlags", "modKit", "extras", "wheelScale", "wheelScaleRear", "dirtLevelMin", "dirtLevelMax", "envEffScale", "seatOffsetDistX", "seatOffsetDistY", "seatOffsetDistZ", "steerWheelMult", "damageMapScale", "damageOffsetScale"],
  streaming: ["lodDistances", "minSeatHeight", "maxNum", "frequency", "scenarioLayout", "populationGroup", "spawnFrequency", "lightSettings", "sirenSettings"],
});
const HANDLING_FIELD_GROUPS = Object.freeze({
  massAndAero: ["fMass", "fInitialDragCoeff", "fDownforceModifier", "fPercentSubmerged"],
  drivetrain: ["fDriveBiasFront", "nInitialDriveGears", "fInitialDriveForce", "fDriveInertia", "fClutchChangeRateScaleUpShift", "fClutchChangeRateScaleDownShift", "fInitialDriveMaxFlatVel"],
  brakesAndSteering: ["fBrakeForce", "fBrakeBiasFront", "fHandBrakeForce", "fSteeringLock"],
  traction: ["fTractionCurveMax", "fTractionCurveMin", "fTractionCurveLateral", "fTractionSpringDeltaMax", "fLowSpeedTractionLossMult", "fTractionLossMult", "fTractionBiasFront", "fTractionBiasRear", "fCamberStiffnesss"],
  suspension: ["fSuspensionForce", "fSuspensionCompDamp", "fSuspensionReboundDamp", "fSuspensionUpperLimit", "fSuspensionLowerLimit", "fSuspensionRaise", "fSuspensionBiasFront", "fSuspensionBiasRear", "fAntiRollBarForce", "fAntiRollBarBiasFront", "fAntiRollBarBiasRear", "fRollCentreHeightFront", "fRollCentreHeightRear"],
  damageAndOther: ["fCollisionDamageMult", "fWeaponDamageMult", "fDeformationDamageMult", "fEngineDamageMult", "fPetrolTankVolume", "fOilVolume", "nMonetaryValue", "fSeatOffsetDistX", "fSeatOffsetDistY", "fSeatOffsetDistZ", "fPopUpLightRotation"],
});
function pickFields(source, groups) {
  const result = {};
  for (const [group, names] of Object.entries(groups)) {
    const fields = {};
    for (const name of new Set(names)) if (source && Object.hasOwn(source, name)) fields[name] = source[name];
    if (Object.keys(fields).length) result[group] = fields;
  }
  return result;
}
function referenceStatus(value) {
  return value ? { value: text(value), resolution: "game-reference-not-yet-resolved" } : null;
}
function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value) {
  if (value == null) return "";
  if (typeof value === "object" && "#text" in value) return String(value["#text"]).trim();
  return String(value).trim();
}

function findItems(node) {
  if (!node || typeof node !== "object") return [];
  if (Object.hasOwn(node, "Item")) return asArray(node.Item);
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      const found = findItems(value);
      if (found.length) return found;
    }
  }
  return [];
}

function parseXml(xml, label) {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new Error(`${label} is not valid XML: ${validation.err?.msg ?? "unknown parse error"}`);
  }
  return parser.parse(xml);
}

/**
 * Extracts only the matching vehicle Item and matching handling Item.
 * Does not rewrite or mutate either original XML document.
 */
export function listVehicleModels(vehiclesXml) {
  const document = parseXml(vehiclesXml, "vehicles.meta");
  return [...new Set(findItems(document).map((item) => text(item.modelName).toLowerCase()).filter(Boolean))].sort();
}

export function inspectVehicleMetadata({ vehiclesXml, handlingXml, modelName }) {
  if (!modelName?.trim()) throw new Error("A target model name is required.");
  const target = modelName.trim().toLowerCase();
  const vehiclesDoc = parseXml(vehiclesXml, "vehicles.meta");
  const handlingDoc = parseXml(handlingXml, "handling.meta");

  const vehicleMatches = findItems(vehiclesDoc).filter((item) =>
    text(item.modelName).toLowerCase() === target
  );
  if (vehicleMatches.length !== 1) {
    throw new Error(`Expected exactly one vehicle entry for "${target}", found ${vehicleMatches.length}.`);
  }

  const vehicle = vehicleMatches[0];
  const handlingId = text(vehicle.handlingId);
  if (!handlingId) throw new Error(`Vehicle "${target}" has no handlingId.`);

  const handlingMatches = findItems(handlingDoc).filter((item) =>
    text(item.handlingName).toLowerCase() === handlingId.toLowerCase()
  );
  if (handlingMatches.length !== 1) {
    throw new Error(`Expected exactly one handling entry for "${handlingId}", found ${handlingMatches.length}.`);
  }

  const txdName = text(vehicle.txdName);
  const model = text(vehicle.modelName);
  return {
    kind: "vehicle-replacement",
    modelName: model,
    txdName,
    handlingId,
    vehicleEntry: vehicle,
    handlingEntry: handlingMatches[0],
    mappedSettings: {
      vehicle: pickFields(vehicle, VEHICLE_FIELD_GROUPS),
      handling: pickFields(handlingMatches[0], HANDLING_FIELD_GROUPS),
    },
    audioReference: referenceStatus(vehicle.audioNameHash),
    cameraReference: referenceStatus(vehicle.cameraName || vehicle.cameraHash || vehicle.firstPersonDrivebyData),
    unmodifiedSourceMetadata: { vehicleEntry: vehicle, handlingEntry: handlingMatches[0], preservation: "all-source-fields-retained" },
    dependencies: {
      modelFiles: [`${model}.yft`, `${model}_hi.yft`],
      textureFiles: txdName ? [`${txdName}.ytd`] : [],
    },
    warnings: [
      "Metadata extraction is not asset conversion.",
      "PC YFT/YTD files are not considered PS4-compatible until a target-build adapter validates them.",
    ],
  };
}
