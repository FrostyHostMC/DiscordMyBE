const DEFAULT_MAX_PROBE_BYTES = 64 * 1024;

function normalizeProbeResult(result, adapterId) {
  if (!result || result.match !== true) return null;
  const confidence = Number(result.confidence ?? 0);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("Adapter " + adapterId + " returned confidence outside 0..1.");
  }
  return {
    adapterId,
    confidence,
    role: typeof result.role === "string" ? result.role : "unknown",
    evidence: Array.isArray(result.evidence) ? result.evidence.filter((item) => typeof item === "string") : [],
    capabilities: Array.isArray(result.capabilities) ? [...new Set(result.capabilities.filter((item) => typeof item === "string"))] : []
  };
}

/**
 * Data-driven format detection. The registry knows no mod names, creators,
 * vehicles, directory conventions, or target-specific assumptions. Each
 * adapter owns its own evidence-based probe and declares its capabilities.
 */
export class FormatAdapterRegistry {
  #adapters = new Map();

  constructor(adapters = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter) {
    if (!adapter || typeof adapter.id !== "string" || !adapter.id.trim()) {
      throw new Error("A format adapter requires a stable, non-empty id.");
    }
    if (this.#adapters.has(adapter.id)) throw new Error("Duplicate format adapter id: " + adapter.id);
    if (typeof adapter.probe !== "function") throw new Error("Adapter " + adapter.id + " must provide probe(file, context).");
    this.#adapters.set(adapter.id, Object.freeze({ ...adapter }));
    return this;
  }

  unregister(adapterId) {
    return this.#adapters.delete(adapterId);
  }

  list() {
    return [...this.#adapters.values()].map(({ id, version, description, capabilities = [] }) => ({
      id, version: version ?? null, description: description ?? "", capabilities: [...capabilities]
    }));
  }

  inspect(file, context = {}, options = {}) {
    const bytes = file?.bytes;
    if (!(bytes instanceof Uint8Array)) {
      throw new Error("Format inspection requires file.bytes to be a Uint8Array.");
    }
    const maxProbeBytes = Math.max(0, Math.min(Number(options.maxProbeBytes) || DEFAULT_MAX_PROBE_BYTES, bytes.length));
    const probeFile = {
      path: typeof file.path === "string" ? file.path : "",
      size: bytes.byteLength,
      extension: extensionOf(file.path),
      bytes: bytes.subarray(0, maxProbeBytes)
    };
    const matches = [];
    const probeErrors = [];
    for (const adapter of this.#adapters.values()) {
      try {
        const result = normalizeProbeResult(adapter.probe(probeFile, context), adapter.id);
        if (result) matches.push({ ...result, priority: Number(adapter.priority) || 0 });
      } catch (error) {
        probeErrors.push({ adapterId: adapter.id, error: error?.message || "Probe failed." });
      }
    }
    matches.sort((a, b) => b.confidence - a.confidence || b.priority - a.priority || a.adapterId.localeCompare(b.adapterId));
    const top = matches[0] || null;
    const tied = top ? matches.filter((item) => item.confidence === top.confidence && item.priority === top.priority) : [];
    const ambiguous = tied.length > 1;
    return {
      path: probeFile.path,
      size: probeFile.size,
      status: !top ? "unrecognized" : ambiguous ? "ambiguous" : "recognized",
      selectedAdapterId: top && !ambiguous ? top.adapterId : null,
      match: top && !ambiguous ? { adapterId: top.adapterId, confidence: top.confidence, role: top.role, evidence: top.evidence, capabilities: top.capabilities } : null,
      candidates: matches.map(({ priority, ...item }) => item),
      probeErrors,
      preservedAsSource: true,
      conversionAuthorized: false
    };
  }

  inspectAll(files, context = {}, options = {}) {
    if (!Array.isArray(files)) throw new Error("files must be an array.");
    return files.map((file) => this.inspect(file, context, options));
  }

  async convert(inspection, file, context = {}) {
    if (!inspection || inspection.status !== "recognized" || !inspection.selectedAdapterId) {
      throw new Error("Conversion requires one unambiguous recognized adapter.");
    }
    const adapter = this.#adapters.get(inspection.selectedAdapterId);
    if (!adapter || typeof adapter.convert !== "function") {
      throw new Error("The selected adapter does not implement conversion.");
    }
    const output = await adapter.convert(file, context);
    if (!output || !(output.bytes instanceof Uint8Array)) {
      throw new Error("Adapter conversion must return bytes as Uint8Array.");
    }
    return {
      ...output,
      adapterId: adapter.id,
      adapterVersion: adapter.version ?? null,
      sourcePreserved: true,
      targetCompatibility: output.targetCompatibility ?? "unverified",
      installable: output.installable === true
    };
  }
}

function extensionOf(path) {
  const name = String(path || "").split(/[\\/]/).pop() || "";
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}
