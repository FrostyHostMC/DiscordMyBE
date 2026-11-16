const VEHICLE_PROPERTY_MAP = Object.freeze({
  livery: "livery",
  dirtlevel: "dirtLevel",
  wheeltype: "wheelType",
  wheelcolor: "wheelColor",
  pearlescentcolor: "pearlescentColor",
  primarycolor: "primaryColor",
  secondarycolor: "secondaryColor",
  platetype: "plateType",
  plateindex: "plateIndex",
  windowtint: "windowTint",
  enginehealth: "engineHealth",
  bodyhealth: "bodyHealth",
  fuellevel: "fuelLevel",
});

function flattenScalars(value, prefix = "", output = []) {
  if (Array.isArray(value)) value.forEach((item, index) => flattenScalars(item, `${prefix}[${index}]`, output));
  else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) flattenScalars(child, prefix ? `${prefix}.${key}` : key, output);
  else if (value != null && String(value).trim() !== "") output.push({ key: prefix, value });
  return output;
}
function finiteVector(value) {
  return value && ["x", "y", "z"].every((axis) => Number.isFinite(Number(value[axis]))) ? { x: Number(value.x), y: Number(value.y), z: Number(value.z) } : null;
}

/**
 * Compiles the supported, data-only portion of a Menyoo vehicle report into
 * a deterministic native action plan. Unknown fields are retained as blockers,
 * never guessed into native calls.
 */
export function compileMenyooNativeActionPlan(report) {
  if (!report?.validXml || report.format !== "menyoo-spooner-vehicle-xml") throw new Error("A valid Menyoo vehicle report is required.");
  const actions = [];
  const blockers = [];
  const unsupportedProperties = [];
  for (const vehicle of report.vehicles) {
    const model = vehicle.modelName || vehicle.modelHash?.raw;
    if (!model) { blockers.push(`${vehicle.id}: no model name or hash was supplied.`); continue; }
    actions.push({ op: "spawn_entity", resultId: vehicle.id, entityKind: "vehicle", model, modelHashUnsigned32: vehicle.modelHash?.unsigned32 ?? null });
    const position = finiteVector(vehicle.transform?.position);
    const rotation = finiteVector(vehicle.transform?.rotation);
    const heading = vehicle.transform?.heading;
    if (position && (rotation || Number.isFinite(heading))) actions.push({ op: "set_transform", entityRef: vehicle.id, position, rotation, heading: Number.isFinite(heading) ? heading : null });
    else blockers.push(`${vehicle.id}: placement is incomplete; spawn transform cannot be compiled safely.`);
    for (const [index, attachment] of (vehicle.attachments || []).entries()) {
      const childId = `${vehicle.id}-attachment-${index + 1}`;
      if (!attachment.model) { blockers.push(`${childId}: attachment model is missing.`); continue; }
      actions.push({ op: "spawn_entity", resultId: childId, entityKind: "object", model: attachment.model, modelHashUnsigned32: attachment.modelHash?.unsigned32 ?? null });
      const offset = finiteVector(attachment.position);
      const attachRotation = finiteVector(attachment.rotation);
      if (!attachment.bone || !offset || !attachRotation) {
        blockers.push(`${childId}: attachment needs a confirmed bone plus offset and rotation.`);
        continue;
      }
      actions.push({ op: "attach_entity", parentRef: vehicle.id, childRef: childId, bone: attachment.bone, offset, rotation: attachRotation });
    }
    for (const property of flattenScalars(vehicle.vehicleProperties || {})) {
      const mapped = VEHICLE_PROPERTY_MAP[property.key.split(".").at(-1).replace(/\[\d+\]$/, "").toLowerCase()];
      const numeric = Number(property.value);
      if (!mapped || !Number.isFinite(numeric)) { unsupportedProperties.push({ vehicleId: vehicle.id, ...property }); continue; }
      actions.push({ op: "set_vehicle_property", entityRef: vehicle.id, property: mapped, value: numeric });
    }
  }
  if (unsupportedProperties.length) blockers.push(`${unsupportedProperties.length} vehicle property value(s) were retained but not mapped to a known native setter.`);
  return {
    schemaVersion: 1,
    kind: "autoport-native-action-plan",
    sourceFormat: report.format,
    target: report.target,
    actions,
    unsupportedProperties,
    execution: { status: blockers.length ? "blocked-by-source-data" : "adapter-required", executable: false, blockers, runtimeRequirement: "A target-specific GoldHEN/Orbis GameApi adapter is required to execute these actions." },
    summary: { vehicles: report.vehicles.length, actions: actions.length, spawns: actions.filter((action) => action.op === "spawn_entity").length, transforms: actions.filter((action) => action.op === "set_transform").length, attachments: actions.filter((action) => action.op === "attach_entity").length, vehicleProperties: actions.filter((action) => action.op === "set_vehicle_property").length, blockers: blockers.length },
  };
}
