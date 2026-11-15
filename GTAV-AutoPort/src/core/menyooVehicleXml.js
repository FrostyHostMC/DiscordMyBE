import { XMLParser, XMLValidator } from "fast-xml-parser";

const MAX_XML_BYTES = 8 * 1024 * 1024;
const MAX_PLACEMENTS = 5000;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => /^(Placement|Attachment|SpoonerAttachment)$/i.test(name),
});

const asArray = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const scalar = (value) => {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object" && "#text" in value) return String(value["#text"]).trim();
  return "";
};
const first = (object, names) => {
  if (!object || typeof object !== "object") return undefined;
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const key = Object.keys(object).find((name) => wanted.has(name.toLowerCase()));
  return key ? object[key] : undefined;
};
const number = (value) => {
  const parsed = Number(scalar(value));
  return Number.isFinite(parsed) ? parsed : null;
};
function vector(node, names) {
  const value = first(node, names);
  if (!value || typeof value !== "object") return null;
  const x = number(first(value, ["X", "x"]));
  const y = number(first(value, ["Y", "y"]));
  const z = number(first(value, ["Z", "z"]));
  return x == null || y == null || z == null ? null : { x, y, z };
}
function walk(value, visitor, path = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visitor, [...path, index]));
    return;
  }
  if (!value || typeof value !== "object") return;
  visitor(value, path);
  for (const [key, child] of Object.entries(value)) walk(child, visitor, [...path, key]);
}
function collectPlacements(parsed) {
  const found = [];
  walk(parsed, (node) => {
    if (Object.keys(node).some((key) => key.toLowerCase() === "modelhash") ||
        Object.keys(node).some((key) => key.toLowerCase() === "hashname")) {
      const type = scalar(first(node, ["Type", "type"])).toLowerCase();
      if (!type || type.includes("vehicle") || first(node, ["VehicleProperties", "SpoonerAttachments", "Attachments"])) found.push(node);
    }
  });
  return found.slice(0, MAX_PLACEMENTS);
}
function parseHash(value) {
  const raw = scalar(value);
  if (!raw) return { raw: null, unsigned32: null };
  let parsed = null;
  try {
    parsed = /^0x[\da-f]+$/i.test(raw) ? Number.parseInt(raw.slice(2), 16) : Number(raw);
  } catch { parsed = null; }
  return { raw, unsigned32: Number.isFinite(parsed) ? parsed >>> 0 : null };
}
function attachmentRecords(placement) {
  const containers = [];
  walk(placement, (node) => {
    for (const [key, value] of Object.entries(node)) {
      if (/^(SpoonerAttachments|Attachments)$/i.test(key)) containers.push(...asArray(value));
    }
  });
  const result = [];
  for (const container of containers) {
    walk(container, (node) => {
      const model = scalar(first(node, ["AttachedObject", "ModelHash", "HashName", "Model"]));
      if (!model) return;
      result.push({
        model,
        modelHash: parseHash(first(node, ["ModelHash", "Hash"])),
        bone: scalar(first(node, ["Bone", "BoneIndex", "AttachBone"])),
        position: vector(node, ["Position", "Offset", "AttachPosition"]),
        rotation: vector(node, ["Rotation", "AttachRotation"]),
        raw: node,
      });
    });
  }
  return result;
}

/**
 * Parse Menyoo/Spooner XML into a loss-preserving intermediate vehicle pack.
 * This is deliberately not a Synapse JSON or PS4 resource writer: the supplied
 * Synapse package has no documented XML contract, and attachments need runtime
 * support before they can be executed on console.
 */
export function translateMenyooVehicleXml(input, sourcePath = "vehicle.xml") {
  const xml = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: false }).decode(input || new Uint8Array());
  if (new TextEncoder().encode(xml).byteLength > MAX_XML_BYTES) throw new Error("Menyoo XML exceeds the 8 MiB inspection limit.");
  const validation = XMLValidator.validate(xml);
  if (validation !== true) return { sourcePath, format: "unknown-xml", validXml: false, error: validation.err?.msg || "Invalid XML", vehicles: [], summary: { vehicleCount: 0, attachmentCount: 0 } };

  const parsed = parser.parse(xml);
  const placements = collectPlacements(parsed);
  const vehicles = placements.map((placement, index) => {
    const modelName = scalar(first(placement, ["HashName", "ModelName", "VehicleModel", "Model"]));
    const modelHash = parseHash(first(placement, ["ModelHash", "Hash"]));
    const transform = first(placement, ["PositionRotation", "Transform", "PositionAndRotation"]) || placement;
    const position = vector(transform, ["Position", "Coords", "Coordinates"]) ||
      (["X", "Y", "Z"].every((axis) => first(transform, [axis]) !== undefined)
        ? { x: number(first(transform, ["X"])), y: number(first(transform, ["Y"])), z: number(first(transform, ["Z"])) } : null);
    const rotation = vector(transform, ["Rotation", "Rot", "Orientation"]);
    const heading = number(first(transform, ["Heading", "Yaw"]));
    const attachments = attachmentRecords(placement);
    const props = first(placement, ["VehicleProperties", "VehicleMods", "Properties"]) || null;
    return {
      id: `vehicle-${index + 1}`,
      modelName: modelName || null,
      modelHash,
      transform: { position, rotation, heading },
      attachments,
      vehicleProperties: props,
      source: { path: sourcePath, rawPlacement: placement },
      conversion: {
        dataPreserved: true,
        spawnReady: false,
        blockers: [
          "A target menu/runtime spawn adapter is required.",
          ...(attachments.length ? ["Attachment creation, bone mapping and transform semantics need PS4 runtime support."] : []),
          ...(props ? ["Vehicle property fields require explicit mapping to supported PS4 game-native setters."] : []),
        ],
      },
    };
  });

  return {
    schemaVersion: 1,
    format: "menyoo-spooner-vehicle-xml",
    sourcePath,
    validXml: true,
    rootElements: Object.keys(parsed),
    vehicles,
    summary: {
      vehicleCount: vehicles.length,
      attachmentCount: vehicles.reduce((sum, vehicle) => sum + vehicle.attachments.length, 0),
      withPosition: vehicles.filter((vehicle) => vehicle.transform.position).length,
      withRotation: vehicles.filter((vehicle) => vehicle.transform.rotation || vehicle.transform.heading != null).length,
      withVehicleProperties: vehicles.filter((vehicle) => vehicle.vehicleProperties != null).length,
      sourcePlacementsCapped: placements.length === MAX_PLACEMENTS,
    },
    target: { titleId: "CUSA00419", updateVersion: "1.73", menuAdapter: "unverified" },
    exportContract: {
      format: "autoport-menyoo-vehicle-pack",
      fileName: "autoport-vehicles.json",
      runtimeRequirements: ["model spawn by verified model hash/name", "world transform application", "vehicle property setters", "attachment creation and bone/offset mapping"],
      compatibility: "intermediate-data-only",
    },
    limitations: [
      "This output preserves source data but is not a PS4 YFT/YTD resource conversion.",
      "The Synapse package supplied for audit contains no XML examples or documented XML loader schema.",
      "No attachment, vehicle-property or spawn action is claimed to work until a menu/runtime adapter is implemented and tested on the target.",
    ],
  };
}

export function buildMenyooVehiclePackExport(report) {
  if (!report?.validXml || report.format !== "menyoo-spooner-vehicle-xml") throw new Error("A valid Menyoo/Spooner vehicle XML report is required.");
  return {
    schemaVersion: 1,
    format: "autoport-menyoo-vehicle-pack",
    source: { path: report.sourcePath, format: report.format },
    target: report.target,
    vehicles: report.vehicles,
    requirements: report.exportContract.runtimeRequirements,
    compatibility: report.exportContract.compatibility,
  };
}
