import { XMLParser, XMLValidator } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === "Item",
});

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
