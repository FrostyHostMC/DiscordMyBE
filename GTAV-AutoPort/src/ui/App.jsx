import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, CarFront, CheckCircle2, FileArchive, FileText, ShieldCheck, Upload, AlertTriangle, LoaderCircle, FolderOpen } from "lucide-react";
import { inspectZipArchive, inspectFolderFiles, classifyVehicleAssets, findByBasename } from "../core/intake.js";
import { inspectVehicleMetadata } from "../core/metadata.js";
import { inspectRsc7 } from "../core/rsc7.js";
import { buildConversionManifest } from "../core/manifest.js";
import { inspectNativeReports } from "../core/nativeReports.js";

const stages = [
  ["01", "Import PC mod", "ZIP archive or extracted folder"],
  ["02", "Analyze vehicle", "Metadata and asset dependencies"],
  ["03", "Inspect resources", "Native YFT structure and YTD textures"],
  ["04", "Convert assets", "PS4-specific conversion adapter"],
  ["05", "Validate & package", "Exact title/build validation"],
];

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function App() {
  const zipInput = useRef(null);
  const folderInput = useRef(null);
  const nativeOutputInput = useRef(null);
  const [archive, setArchive] = useState(null);
  const [modelName, setModelName] = useState("glendale");
  const [analysis, setAnalysis] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [nativeReports, setNativeReports] = useState(null);
  const [previewUrls, setPreviewUrls] = useState({});

  useEffect(() => {
    if (!nativeReports?.ytd?.textures) { setPreviewUrls({}); return undefined; }
    const urls = {};
    for (const [index, texture] of nativeReports.ytd.textures.entries()) {
      const key = `${texture.name_hash || texture.name}-${index}`;
      if (texture.previewBytes) urls[key] = URL.createObjectURL(new Blob([texture.previewBytes], { type: "image/png" }));
    }
    setPreviewUrls(urls);
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
  }, [nativeReports]);

  const visibleFiles = useMemo(() => {
    if (!archive) return [];
    return filter === "all" ? archive.inventory : archive.inventory.filter((item) => item.extension === filter);
  }, [archive, filter]);

  async function loadImport(work) {
    setBusy(true); setError(""); setAnalysis(null); setManifest(null); setArchive(null);
    try {
      const result = await work();
      setArchive(result);
      setFilter("all");
    } catch (err) {
      setError(err?.message || "Could not inspect this import.");
    } finally {
      setBusy(false);
    }
  }

  function importZip(file) {
    if (file) loadImport(() => inspectZipArchive(file));
  }

  function importFolder(files) {
    if (files?.length) loadImport(() => inspectFolderFiles(files));
  }

  async function importNativeOutput(files) {
    if (!files?.length) return;
    setBusy(true); setError("");
    try {
      const folder = await inspectFolderFiles(files);
      const reports = inspectNativeReports(folder.files);
      setNativeReports(reports);
    } catch (err) {
      setError(err?.message || "Could not load native inspection reports.");
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
      if (!vehiclesFile || !handlingFile) throw new Error("Both vehicles.meta and handling.meta must be present in the imported mod.");
      const decoder = new TextDecoder("utf-8");
      const metadata = inspectVehicleMetadata({
        vehiclesXml: decoder.decode(vehiclesFile.bytes),
        handlingXml: decoder.decode(handlingFile.bytes),
        modelName,
      });
      const assetChecks = classifyVehicleAssets(archive.files, metadata.modelName).map((asset) => {
        const file = asset.path ? archive.files.find((item) => item.path === asset.path) : null;
        const resource = file ? inspectRsc7(file.bytes, file.path) : null;
        return {
          name: asset.name,
          path: asset.path ?? null,
          present: asset.present,
          ambiguous: asset.ambiguous,
          size: asset.size,
          resource,
        };
      });
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
      <header><div><div className="eyebrow">GTAV AUTO PORT / WORKSPACE</div><h1>Vehicle conversion</h1><p>Import a PC replacement mod, inspect its metadata, and load native YFT/YTD resource reports.</p></div><div className="status"><i/> DEVELOPMENT BUILD</div></header>

      <section className="hero">
        <div className="hero-copy"><div className="eyebrow">FIRST TARGET · GLENDALE</div><h2>PC vehicle → PS4 Story Mode</h2><p>Import a ZIP or extracted folder, then load the native inspector output to review YFT structure and YTD texture previews. Console compatibility is never assumed.</p>
          <input ref={zipInput} className="file-input" type="file" accept=".zip,application/zip" onChange={(event) => importZip(event.target.files?.[0])}/>
          <input ref={folderInput} className="file-input" type="file" webkitdirectory="" directory="" multiple onChange={(event) => importFolder(event.target.files)}/>
          <input ref={nativeOutputInput} className="file-input" type="file" webkitdirectory="" directory="" multiple onChange={(event) => importNativeOutput(event.target.files)}/>
          <div className="import-actions">
            <button className="primary-button" onClick={() => zipInput.current?.click()} disabled={busy}><Upload size={16}/>{busy ? "Working…" : "Import ZIP mod"}</button>
            <button className="secondary-button" onClick={() => folderInput.current?.click()} disabled={busy}><FolderOpen size={16}/> Import folder</button>
            <button className="secondary-button" onClick={() => nativeOutputInput.current?.click()} disabled={busy}><FileText size={16}/> Load native reports</button>
          </div>
          <span className="privacy-note">Files stay in this browser session; nothing is uploaded.</span>
        </div>
        <div className="hero-art"><div className="orb orb-one"/><div className="orb orb-two"/><CarFront size={112} strokeWidth={1.05}/><span>VEHICLE PIPELINE</span></div>
      </section>

      {error && <div className="error-panel"><AlertTriangle size={18}/><span>{error}</span></div>}
      {busy && <div className="working"><LoaderCircle size={17}/> Inspecting locally…</div>}

      {archive && <section className="panel">
        <div className="panel-head"><div><div className="eyebrow">SOURCE IMPORT</div><h3>{archive.sourceName}</h3><p>{archive.files.length} files · {formatBytes(archive.totalBytes)} total</p></div><span className="tag success"><CheckCircle2 size={13}/> INSPECTED</span></div>
        <div className="file-toolbar"><span>FILE INVENTORY</span><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All file types</option>{[...new Set(archive.inventory.map((f) => f.extension).filter(Boolean))].sort().map((ext) => <option key={ext} value={ext}>{ext}</option>)}</select></div>
        <div className="file-list">{visibleFiles.map((file) => <div className="file-row" key={file.path}><FileText size={15}/><span className="file-name">{file.path}</span><span className="file-ext">{file.extension || "FILE"}</span><span className="file-size">{formatBytes(file.size)}</span></div>)}</div>
        <div className="analyzer"><label htmlFor="model-name">Vehicle model name</label><div className="analyzer-controls"><input id="model-name" value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="e.g. glendale"/><button className="primary-button" onClick={analyzeVehicle} disabled={busy || !modelName.trim()}>Analyze vehicle</button></div><p>For the Crown Victoria test fixture, use <b>glendale</b>. Ambiguous duplicate metadata files are rejected instead of choosing one silently.</p></div>
      </section>}

      {nativeReports && <section className="panel results-panel">
        <div className="panel-head"><div><div className="eyebrow">NATIVE RESOURCE INSPECTION</div><h3>Inspector reports loaded</h3><p>{nativeReports.sourceFiles} files · {nativeReports.yftReports.length ? `${nativeReports.yftReports.length} YFT parsed` : "No YFT report"} · {nativeReports.ytd ? `${nativeReports.ytd.texture_count} YTD textures` : "No YTD report"}</p></div><span className="tag success"><CheckCircle2 size={13}/> REPORTS IMPORTED</span></div>
        {nativeReports.yftReports.map((report) => <div className="native-summary" key={report.source_file}>
          <div className="eyebrow">YFT FRAGMENT · {report.fragment.name || report.source_file}</div>
          <div className="native-metrics">
            <div><b>{report.fragment.main_drawable?.model_count ?? 0}</b><span>Models</span></div>
            <div><b>{report.fragment.main_drawable?.geometry_count ?? 0}</b><span>Geometries</span></div>
            <div><b>{report.fragment.main_drawable?.triangle_count_sum_across_lods ?? 0}</b><span>Triangles</span></div>
            <div><b>{report.fragment.bone_transform_count ?? 0}</b><span>Bone transforms</span></div>
            <div><b>{report.fragment.physics_child_count ?? 0}</b><span>Physics children</span></div>
          </div>
          <p className="native-disclaimer">Structural parsing succeeded for {report.source_file}. This does not establish PS4 compatibility or convert the YFT.</p>
        </div>)}
        {nativeReports.ytd && <div className="native-textures">
          <div className="eyebrow">YTD TEXTURE DICTIONARY · {nativeReports.ytd.texture_count} TEXTURES</div>
          <div className="texture-grid">{nativeReports.ytd.textures.map((texture, index) => {
            const key = `${texture.name_hash || texture.name}-${index}`;
            return <article className="texture-card" key={key}>
              {previewUrls[key] ? <img src={previewUrls[key]} alt={`${texture.name} texture preview`} loading="lazy"/> : <div className="texture-placeholder"><FileText size={22}/><span>Preview unavailable</span></div>}
              <div><b>{texture.name}</b><small>{texture.width} × {texture.height} · {texture.format}</small><small>{texture.mip_levels} mip levels · {texture.depth}-D</small></div>
            </article>;
          })}</div>
        </div>}
        <div className="notice"><ShieldCheck size={19}/><div><b>Inspection reports only — not a PS4 conversion.</b><p>These reports describe the source resource. DDS and PNG exports are inspection artifacts. No source asset is rewritten and no deployment package is produced.</p></div></div>
      </section>}

      {analysis && <section className="panel results-panel">
        <div className="panel-head"><div><div className="eyebrow">ANALYSIS RESULT</div><h3>{analysis.metadata.modelName} · Vehicle replacement</h3><p>Handling reference: {analysis.metadata.handlingId} · Texture dictionary: {analysis.metadata.txdName}</p></div><span className="tag warning"><AlertTriangle size={13}/> NOT CONVERTED</span></div>
        <div className="asset-grid">{analysis.assetChecks.map((asset) => <div className="asset-card" key={asset.name}><div className="asset-top"><span>{asset.name}</span>{asset.present && !asset.ambiguous ? <CheckCircle2 size={15}/> : <AlertTriangle size={15}/>}</div><b>{asset.ambiguous ? "Ambiguous" : asset.present ? "Found" : "Missing"}</b><small>{asset.path || "No unique matching path"}</small><small>{asset.present ? formatBytes(asset.size) : "Required asset not found"}</small><small>{asset.resource?.valid ? `RSC7 v${asset.resource.version} · ${asset.resource.fixtureVersionMatch ? "matches Glendale sample" : "not a sample match"}` : asset.resource?.reason || asset.resource?.status || "Not inspected"}</small></div>)}</div>
        <div className="notice"><ShieldCheck size={19}/><div><b>Metadata and header inspection only. PS4 conversion has not passed.</b><p>RSC7 identifies a resource container, not its target platform. No decompression, geometry or texture decoding, rewriting, or deployment is performed. No installable package is generated.</p></div></div>
        {manifest && <button className="secondary-button" onClick={() => downloadJson(manifest, `${analysis.metadata.modelName}-autoport-manifest.json`)}><ArrowDownToLine size={15}/> Export conversion manifest</button>}
      </section>}

      <div className="section-head"><div><div className="eyebrow">WORKFLOW</div><h3>Conversion pipeline</h3></div><span className="muted">5 stages</span></div>
      <div className="stages">{stages.map(([n,title,desc])=><article className="stage" key={n}><div className="stage-number">{n}</div><h4>{title}</h4><p>{desc}</p><span className="stage-state">{n==="01"?"AVAILABLE":n==="02"?"METADATA ANALYSIS":n==="03"?"NATIVE REPORTS":"PLANNED"}</span></article>)}</div>
      <footer>GTAV AUTOPORT <span>·</span> LOCAL-FIRST <span>·</span> NO GTA ONLINE SUPPORT</footer>
    </section>
  </main>;
}
