import React, { useMemo, useRef, useState } from "react";
import { ArrowDownToLine, CarFront, CheckCircle2, FileArchive, FileText, ShieldCheck, Upload, AlertTriangle, LoaderCircle } from "lucide-react";
import { inspectZipArchive, classifyVehicleAssets, findByBasename } from "../core/intake.js";
import { inspectVehicleMetadata } from "../core/metadata.js";
import { buildConversionManifest } from "../core/manifest.js";

const stages = [
  ["01", "Import PC mod", "ZIP archive intake and file inventory"],
  ["02", "Analyze vehicle", "Metadata, models, textures, dependencies"],
  ["03", "Convert assets", "Format-specific PS4 conversion adapters"],
  ["04", "Validate target", "Title ID, game build, references and paths"],
  ["05", "Build outputs", "Loose files and deployment package"],
];

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function App() {
  const fileInput = useRef(null);
  const [archive, setArchive] = useState(null);
  const [modelName, setModelName] = useState("glendale");
  const [analysis, setAnalysis] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  const visibleFiles = useMemo(() => {
    if (!archive) return [];
    if (filter === "all") return archive.inventory;
    return archive.inventory.filter((item) => item.extension === filter);
  }, [archive, filter]);

  async function importArchive(file) {
    if (!file) return;
    setBusy(true); setError(""); setAnalysis(null); setManifest(null);
    try {
      const result = await inspectZipArchive(file);
      setArchive(result);
    } catch (err) {
      setArchive(null);
      setError(err?.message || "Could not inspect this archive.");
    } finally {
      setBusy(false);
    }
  }

  async function analyzeVehicle() {
    if (!archive) return;
    setBusy(true); setError(""); setAnalysis(null); setManifest(null);
    try {
      const vehiclesFile = findByBasename(archive.files, "vehicles.meta");
      const handlingFile = findByBasename(archive.files, "handling.meta");
      if (!vehiclesFile || !handlingFile) throw new Error("Both vehicles.meta and handling.meta must be present in the imported archive.");
      const decoder = new TextDecoder("utf-8");
      const metadata = inspectVehicleMetadata({
        vehiclesXml: decoder.decode(vehiclesFile.bytes),
        handlingXml: decoder.decode(handlingFile.bytes),
        modelName,
      });
      const assetChecks = classifyVehicleAssets(archive.files, metadata.modelName);
      const result = { metadata, assetChecks };
      setAnalysis(result);
      const built = await buildConversionManifest({
        sourceName: archive.sourceName,
        files: archive.files,
        metadata,
        assetChecks,
      });
      setManifest(built);
    } catch (err) {
      setError(err?.message || "Vehicle analysis failed.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="shell">
    <aside className="rail">
      <div className="brand"><span className="brand-mark"><CarFront size={19}/></span><span>AutoPort</span></div>
      <div className="rail-label">WORKSPACE</div>
      <div className="nav active"><FileArchive size={17}/> Mod Converter</div>
      <div className="rail-label">PIPELINE</div>
      <div className="nav"><ShieldCheck size={17}/> Compatibility gates</div>
      <div className="rail-foot">LOCAL WORKSPACE<br/><b>PS4 · STORY MODE</b></div>
    </aside>
    <section className="content">
      <header><div><div className="eyebrow">GTAV AUTO PORT / WORKSPACE</div><h1>Vehicle conversion</h1><p>Import a PC replacement mod and inspect its files and vehicle metadata.</p></div><div className="status"><i/> DEVELOPMENT BUILD</div></header>

      <section className="hero">
        <div className="hero-copy"><div className="eyebrow">FIRST TARGET · GLENDALE</div><h2>PC vehicle → PS4 Story Mode</h2><p>AutoPort now reads ZIP archives locally, inventories their contents, and checks the selected vehicle's metadata and asset dependencies. Binary conversion is still a separate stage.</p>
          <input ref={fileInput} className="file-input" type="file" accept=".zip,application/zip" onChange={(event) => importArchive(event.target.files?.[0])}/>
          <button className="primary-button" onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={16}/>{busy ? "Working…" : "Import ZIP mod"}</button>
          <span className="privacy-note">Files stay in this browser session; nothing is uploaded.</span>
        </div>
        <div className="hero-art"><div className="orb orb-one"/><div className="orb orb-two"/><CarFront size={112} strokeWidth={1.05}/><span>VEHICLE PIPELINE</span></div>
      </section>

      {error && <div className="error-panel"><AlertTriangle size={18}/><span>{error}</span></div>}
      {busy && <div className="working"><LoaderCircle size={17}/> Inspecting locally…</div>}

      {archive && <section className="panel">
        <div className="panel-head"><div><div className="eyebrow">SOURCE ARCHIVE</div><h3>{archive.sourceName}</h3><p>{archive.files.length} files · {formatBytes(archive.totalBytes)} uncompressed</p></div><span className="tag success"><CheckCircle2 size={13}/> INSPECTED</span></div>
        <div className="file-toolbar"><span>FILE INVENTORY</span><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All file types</option>{[...new Set(archive.inventory.map((f) => f.extension).filter(Boolean))].sort().map((ext) => <option key={ext} value={ext}>{ext}</option>)}</select></div>
        <div className="file-list">{visibleFiles.map((file) => <div className="file-row" key={file.path}><FileText size={15}/><span className="file-name">{file.path}</span><span className="file-ext">{file.extension || "FILE"}</span><span className="file-size">{formatBytes(file.size)}</span></div>)}</div>
        <div className="analyzer"><label htmlFor="model-name">Vehicle model name</label><div className="analyzer-controls"><input id="model-name" value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="e.g. glendale"/><button className="primary-button" onClick={analyzeVehicle} disabled={busy || !modelName.trim()}>Analyze vehicle</button></div><p>For the first fixture, use <b>glendale</b>. Metadata files are matched by filename, even when nested in folders.</p></div>
      </section>}

      {analysis && <section className="panel results-panel">
        <div className="panel-head"><div><div className="eyebrow">ANALYSIS RESULT</div><h3>{analysis.metadata.modelName} · Vehicle replacement</h3><p>Handling reference: {analysis.metadata.handlingId} · Texture dictionary: {analysis.metadata.txdName}</p></div><span className="tag warning"><AlertTriangle size={13}/> NOT CONVERTED</span></div>
        <div className="asset-grid">{analysis.assetChecks.map((asset) => <div className="asset-card" key={asset.name}><div className="asset-top"><span>{asset.name}</span>{asset.present ? <CheckCircle2 size={15}/> : <AlertTriangle size={15}/>}</div><b>{asset.present ? "Found" : "Missing"}</b><small>{asset.present ? formatBytes(asset.size) : "Required asset not found"}</small><small>{asset.signature}</small></div>)}</div>
        <div className="notice"><ShieldCheck size={19}/><div><b>Metadata checks passed. PS4 conversion has not.</b><p>AutoPort found the selected vehicle and its matching handling entry. PC RSC7 assets still require a PS4-specific conversion and target-build validation. No installable package is generated.</p></div></div>
        {manifest && <button className="secondary-button" onClick={() => downloadJson(manifest, `${analysis.metadata.modelName}-autoport-manifest.json`)}><ArrowDownToLine size={15}/> Export conversion manifest</button>}
      </section>}

      <div className="section-head"><div><div className="eyebrow">WORKFLOW</div><h3>Conversion pipeline</h3></div><span className="muted">5 stages</span></div>
      <div className="stages">{stages.map(([n,title,desc])=><article className="stage" key={n}><div className="stage-number">{n}</div><h4>{title}</h4><p>{desc}</p><span className="stage-state">{n==="01"?"AVAILABLE":n==="02"?"METADATA ANALYSIS":"PLANNED"}</span></article>)}</div>
      <footer>GTAV AUTOPORT <span>·</span> LOCAL-FIRST <span>·</span> NO GTA ONLINE SUPPORT</footer>
    </section>
  </main>;
}
