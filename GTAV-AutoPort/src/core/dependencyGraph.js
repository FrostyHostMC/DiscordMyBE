const RESOURCE_TYPES = Object.freeze({
  ".yft": "vehicle-fragment",
  ".ydr": "drawable",
  ".ydd": "drawable-dictionary",
  ".ytd": "texture-dictionary",
  ".ybn": "collision",
  ".meta": "xml-metadata",
  ".ymt": "rage-metadata",
  ".ymf": "manifest",
  ".ytyp": "archetype",
  ".ycd": "animation",
  ".awc": "audio-container",
  ".dat": "data",
  ".ini": "configuration",
  ".xml": "xml",
});

const basename = (path) => path.split("/").at(-1).toLowerCase();

function resolveByName(files, expected) {
  const matches = files.filter((file) => basename(file.path) === expected.toLowerCase());
  return {
    expected,
    status: matches.length === 0 ? "missing" : matches.length === 1 ? "resolved" : "ambiguous",
    paths: matches.map((file) => file.path),
    count: matches.length,
  };
}

export function buildVehicleDependencyGraph({ files, metadata = null } = {}) {
  const nodes = files.map((file) => ({
    id: file.path,
    path: file.path,
    extension: file.extension || "",
    type: RESOURCE_TYPES[file.extension] || "unclassified",
    size: file.size,
  }));
  const edges = [];
  const dependencies = [];
  if (metadata) {
    for (const name of metadata.dependencies?.modelFiles || []) {
      const result = resolveByName(files, name);
      dependencies.push({ kind: "model", ...result });
      for (const path of result.paths) edges.push({ from: "vehicle", to: path, kind: "model-resource", status: result.status });
    }
    for (const name of metadata.dependencies?.textureFiles || []) {
      const result = resolveByName(files, name);
      dependencies.push({ kind: "texture-dictionary", ...result });
      for (const path of result.paths) edges.push({ from: "vehicle", to: path, kind: "texture-resource", status: result.status });
    }
    const handlingFile = resolveByName(files, "handling.meta");
    dependencies.push({ kind: "handling-metadata-file", ...handlingFile });
    for (const path of handlingFile.paths) edges.push({ from: "vehicle", to: path, kind: "handling-metadata", status: handlingFile.status });
  }
  const byType = nodes.reduce((counts, node) => {
    counts[node.type] = (counts[node.type] || 0) + 1;
    return counts;
  }, {});
  return {
    schemaVersion: 1,
    scope: "inventory-and-explicit-vehicle-metadata-references",
    nodes,
    edges,
    dependencies,
    summary: {
      fileCount: nodes.length,
      resourceTypeCounts: byType,
      resolved: dependencies.filter((item) => item.status === "resolved").length,
      missing: dependencies.filter((item) => item.status === "missing").length,
      ambiguous: dependencies.filter((item) => item.status === "ambiguous").length,
    },
    limitations: [
      "This is an inventory-level dependency graph, not a complete GTA V DLC/archive dependency resolver.",
      "Only references explicitly derived from the selected vehicle metadata are linked; unknown resource relationships remain unresolved.",
    ],
  };
}
