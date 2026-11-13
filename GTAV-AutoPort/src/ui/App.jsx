import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, CarFront, CheckCircle2, FileArchive, FileText, ShieldCheck, Upload, AlertTriangle, LoaderCircle, FolderOpen } from "lucide-react";
import { inspectZipArchive, inspectFolderFiles, classifyVehicleAssets, findByBasename } from "../core/intake.js";
import { inspectVehicleMetadata, listVehicleModels } from "../core/metadata.js";
import { buildVehicleDependencyGraph } from "../core/dependencyGraph.js";
import { inspectRsc7 } from "../core/rsc7.js";
import { buildConversionManifest } from "../core/manifest.js";
import { inspectNativeReports } from "../core/nativeReports.js";
import { inspectNativeAssetsAutomatically } from "../core/autoNative.js";
import { PS4_TARGET, describeTarget } from "../core/target.js";
import { assessPs4Compatibility } from "../core/compatibility.js";
import { auditModFiles } from "../core/modClassifier.js";
import { buildUniversalPortPlan } from "../core/portPlan.js";

const stages = [
  ["01", "Import PC mod", "ZIP archive or extracted folder"],
  ["02", "Classify mod", "Assets, scripts, plugins and dependencies"],
  ["03", "Inspect resources", "Automatic format-specific reports"],
  ["04", "Adapt resources", "Target-specific conversion adapters"],
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
  const [archive, setArchive] = useState(null);
  const [modAudit, setModAudit] = useState(null);
  const [portPlan, setPortPlan] = useState(null);
  const [modelName, setModelName] = useState("");
  const [availableModels, setAvailableModels] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [nativeReports, setNativeReports] = useState(null);
  const [nativeStatus, setNativeStatus] = useState("Native reports are generated automatically after import.");
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

  const compatibility = useMemo(() => assessPs4Compatibility({ target: PS4_TARGET }), []);

  const visibleFiles = useMemo(() => {
    if (!archive) return [];
    return filter === "all" ? archive.inventory : archive.inventory.filter((item) => item.extension === filter);
  }, [archive, filter]);

  async function loadImport(work) {
    setBusy(true); setError(""); setAnalysis(null); setManifest(null); setArchive(null); setModAudit(null); setPortPlan(null); setNativeReports(null); setNativeStatus("Preparing automatic native inspection…");
    try {
      const result = await work();
      setArchive(result);
      setModAudit(auditModFiles(result.files));
      setPortPlan(buildUniversalPortPlan({ files: result.files }));
      setFilter("all");
      const vehiclesMeta = result.files.find((file) => file.path.split("/").at(-1).toLowerCase() === "vehicles.meta");
      if (vehiclesMeta) {
        try {
          const models = listVehicleModels(new TextDecoder("utf-8").decode(vehiclesMeta.bytes));
          setAvailableModels(models);
          setModelName(models.length === 1 ? models[0] : "");
        } catch { setAvailableModels([]); setModelName(""); }
      } else { setAvailableModels([]); setModelName(""); }
      const nativeFiles = result.files.filter((file) => /\.(yft|ytd)$/i.test(file.path));
      if (nativeFiles.length) {
        setNativeStatus("Automatically inspecting YFT/YTD resources locally. First run may compile the inspector.");
        const generated = await inspectNativeAssetsAutomatically(result.files);
        setNativeReports(inspectNativeReports(generated));
        setNativeStatus(`Automatically inspected ${nativeFiles.length} YFT/YTD resource(s); texture previews appear when decoding succeeds.`);
      } else setNativeStatus("No YFT/YTD resources found in this import.");
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
      const dependencyGraph = buildVehicleDependencyGraph({ files: archive.files, metadata });
      const result = { metadata, assetChecks, dependencyGraph };
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
      <header><div><div className="eyebrow">GTAV AUTO PORT / WORKSPACE</div><h1>Universal mod conversion</h1><p>Import a PC GTA V mod. AutoPort inventories its files, identifies mod families, flags PC-only runtime dependencies, and automatically inspects supported native resources.</p></div><div className="status"><i/> DEVELOPMENT BUILD</div></header>

      <section className="hero">
        <div className="hero-copy"><div className="eyebrow">UNIVERSAL PC MOD INTAKE</div><h2>PC mod → PS4 Story Mode</h2><p className="target-profile"><b>{describeTarget()}</b><span>Target supplied by you · resource compatibility not yet verified</span></p><p>Import a ZIP or extracted folder. Mod-family detection and the initial compatibility audit run automatically. Supported native resource reports and texture previews are generated locally. Console compatibility is never assumed.</p>
          <input ref={zipInput} className="file-input" type="file" accept=".zip,application/zip" onChange={(event) => importZip(event.target.files?.[0])}/>
          <input ref={folderInput} className="file-input" type="file" webkitdirectory="" directory="" multiple onChange={(event) => importFolder(event.target.files)}/>
          <div className="import-actions">
            <button className="primary-button" onClick={() => zipInput.current?.click()} disabled={busy}><Upload size={16}/>{busy ? "Working…" : "Import ZIP mod"}</button>
            <button className="secondary-button" onClick={() => folderInput.current?.click()} disabled={busy}><FolderOpen size={16}/> Import folder</button>
          </div>
          <span className="privacy-note">Files stay in this browser session; nothing is uploaded.</span>
        </div>
        <div className="hero-art"><div className="orb orb-one"/><div className="orb orb-two"/><CarFront size={112} strokeWidth={1.05}/><span>UNIVERSAL MOD PIPELINE</span></div>
      </section>

      <section className="panel">
        <div className="panel-head"><div><div className="eyebrow">PS4 COMPATIBILITY GATES</div><h3>Target validation checklist</h3><p>{compatibility.passed} of {compatibility.total} evidence gates satisfied · conversion remains locked</p></div><span className="tag warning"><AlertTriangle size={13}/> BLOCKED</span></div>
        <div className="file-list">{compatibility.gates.map((gate) => <div className="file-row" key={gate.id}><AlertTriangle size={15}/><span className="file-name"><b>{gate.label}</b><small>{gate.nextStep}</small></span><span className="file-ext">PENDING</span></div>)}</div>
        <div className="notice"><ShieldCheck size={19}/><div><b>Why this is locked</b><p>{compatibility.note} The next step is collecting exact-build PS4 reference evidence before implementing any resource writer.</p></div></div>
      </section>

      {error && <div className="error-panel"><AlertTriangle size={18}/><span>{error}</span></div>}
      {busy && <div className="working"><LoaderCircle size={17}/> {nativeStatus}</div>
      {!busy && <div className="privacy-note">{nativeStatus}</div>}}

      {archive && <section className="panel">
        <div className="panel-head"><div><div className="eyebrow">SOURCE IMPORT</div><h3>{archive.sourceName}</h3><p>{archive.files.length} files · {formatBytes(archive.totalBytes)} total · automatic mod audit complete</p></div><span className="tag success"><CheckCircle2 size={13}/> INSPECTED</span></div>
        <div className="file-toolbar"><span>FILE INVENTORY</span><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All file types</option>{[...new Set(archive.inventory.map((f) => f.extension).filter(Boolean))].sort().map((ext) => <option key={ext} value={ext}>{ext}</option>)}</select></div>
        <div className="file-list">{visibleFiles.map((file) => <div className="file-row" key={file.path}><FileText size={15}/><span className="file-name">{file.path}</span><span className="file-ext">{file.extension || "FILE"}</span><span className="file-size">{formatBytes(file.size)}</span></div>)}</div>
        <div className="analyzer"><label htmlFor="model-name">Optional deep vehicle metadata analysis</label><div className="analyzer-controls"><input id="model-name" list="vehicle-model-options" value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder={availableModels.length ? "Choose a detected model" : "Enter model name (if this is a vehicle mod)"}/><datalist id="vehicle-model-options">{availableModels.map((model) => <option key={model} value={model}/>)}</datalist><button className="primary-button" onClick={analyzeVehicle} disabled={busy || !modelName.trim()}>Analyze vehicle metadata</button></div><p>{availableModels.length ? `${availableModels.length} vehicle model(s) detected from vehicles.meta. Select the vehicle you want to analyze.` : "Vehicle model names are discovered from the imported metadata when available. Ambiguous duplicate assets are never selected silently."}</p></div>
      </section>}

      {modAudit && <section className="panel">
        <div className="panel-head"><div><div className="eyebrow">AUTOMATIC MOD AUDIT</div><h3>Detected mod contents</h3><p>{modAudit.summary.fileCount} files classified · {Object.keys(modAudit.summary.familyCounts).length} content families · {modAudit.summary.attentionCount} items need review</p></div><span className="tag success"><CheckCircle2 size={13}/> AUTO-ANALYZED</span></div>
        <div className="audit-grid">{Object.entries(modAudit.summary.familyCounts).sort((a,b)=>b[1]-a[1]).map(([family,count])=><div className="audit-card" key={family}><b>{count}</b><span>{family.replaceAll("-"," ")}</span></div>)}</div>
        {modAudit.summary.pcNativePlugins > 0 && <div className="notice"><AlertTriangle size={19}/><div><b>{modAudit.summary.pcNativePlugins} PC-native plugin(s) detected</b><p>ASI, Windows DLL and EXE files cannot be copied to PS4 as working plugins. They require a separate PS4-native implementation, if the behavior and runtime APIs make that feasible.</p></div></div>}
        {modAudit.summary.unknownFiles > 0 && <div className="notice"><FileText size={19}/><div><b>{modAudit.summary.unknownFiles} unrecognized file(s) preserved in the inventory</b><p>Unknown files are not discarded. Their formats must be identified before conversion or packaging.</p></div></div>}
        {modAudit.warnings.slice(0,12).map((warning,index)=><div className="audit-warning" key={warning.path+index}><AlertTriangle size={14}/><span><b>{warning.path}</b> — {warning.message}</span></div>)}
        <p className="native-disclaimer">{modAudit.note}</p>
      </section>}

      {portPlan && <section className="panel">
        <div className="panel-head"><div><div className="eyebrow">AUTOMATIC PORT PLAN</div><h3>Family-specific conversion worklist</h3><p>{portPlan.summary.fileCount} resources routed across {portPlan.summary.familyCount} families · {portPlan.summary.blockedCount} require an adapter or manual review</p></div><span className="tag warning"><AlertTriangle size={13}/> PLAN ONLY</span></div>
        <div className="audit-grid">
          {Object.entries(portPlan.summary.statusCounts).map(([status,count])=><div className="audit-card" key={status}><b>{count}</b><span>{status.replaceAll("-"," ")}</span></div>)}
        </div>
        <div className="file-list">{portPlan.pipeline.map((stage)=><div className="file-row" key={stage.stage}><FileText size={15}/><span className="file-name"><b>{stage.stage.replaceAll("-"," ")}</b><small>{stage.files.length} resource(s) · {stage.files.slice(0,3).join(", ")}{stage.files.length>3?" …":""}</small></span><span className="file-ext">PLANNED</span></div>)}</div>
        {portPlan.resources.filter((item)=>item.status!=="analysis-or-authoring-only").slice(0,16).map((item)=><div className="audit-warning" key={item.path}><AlertTriangle size={14}/><span><b>{item.path}</b> — {item.status.replaceAll("-"," ")} · {item.blocker}</span></div>)}
        <p className="native-disclaimer">This is a conversion work plan, not a conversion result. Candidate filename relationships are explicitly unverified. No resource bytes have been rewritten and no installable package exists.</p>
        <button className="secondary-button" onClick={()=>downloadJson(portPlan,"gtav-autoport-port-plan.json")}><ArrowDownToLine size={15}/> Export port plan</button>
      </section>}
      {nativeReports && <section className="panel results-panel">
        <div className="panel-head"><div><div className="eyebrow">NATIVE RESOURCE INSPECTION</div><h3>Automatic inspector reports</h3><p>{nativeReports.sourceFiles} files · {nativeReports.yftReports.length ? `${nativeReports.yftReports.length} YFT parsed` : "No YFT report"} · {nativeReports.ytd ? `${nativeReports.ytd.texture_count} YTD textures` : "No YTD report"}</p></div><span className="tag success"><CheckCircle2 size={13}/> AUTO-INSPECTED</span></div>
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
        <div className="notice"><FileText size={19}/><div><b>Dependency inventory</b><p>{analysis.dependencyGraph.summary.resolved} resolved · {analysis.dependencyGraph.summary.missing} missing · {analysis.dependencyGraph.summary.ambiguous} ambiguous references across {analysis.dependencyGraph.summary.fileCount} imported files. This is an initial metadata-linked graph; full DLC and resource dependency resolution remains future work.</p></div></div><div className="asset-grid">{analysis.assetChecks.map((asset) => <div className="asset-card" key={asset.name}><div className="asset-top"><span>{asset.name}</span>{asset.present && !asset.ambiguous ? <CheckCircle2 size={15}/> : <AlertTriangle size={15}/>}</div><b>{asset.ambiguous ? "Ambiguous" : asset.present ? "Found" : "Missing"}</b><small>{asset.path || "No unique matching path"}</small><small>{asset.present ? formatBytes(asset.size) : "Required asset not found"}</small><small>{asset.resource?.valid ? `RSC7 v${asset.resource.version} · ${asset.resource.fixtureVersionMatch ? "matches Glendale sample" : "not a sample match"}` : asset.resource?.reason || asset.resource?.status || "Not inspected"}</small></div>)}</div>
        <div className="notice"><ShieldCheck size={19}/><div><b>Metadata and header inspection only. PS4 conversion has not passed.</b><p>RSC7 identifies a resource container, not its target platform. No decompression, geometry or texture decoding, rewriting, or deployment is performed. No installable package is generated.</p></div></div>
        {manifest && <button className="secondary-button" onClick={() => downloadJson(manifest, `${analysis.metadata.modelName}-autoport-manifest.json`)}><ArrowDownToLine size={15}/> Export conversion manifest</button>}
      </section>}

      <div className="section-head"><div><div className="eyebrow">WORKFLOW</div><h3>Universal conversion pipeline</h3></div><span className="muted">5 stages</span></div>
      <div className="stages">{stages.map(([n,title,desc])=><article className="stage" key={n}><div className="stage-number">{n}</div><h4>{title}</h4><p>{desc}</p><span className="stage-state">{n==="01"?"AVAILABLE":n==="02"?"METADATA ANALYSIS":n==="03"?"NATIVE REPORTS":"PLANNED"}</span></article>)}</div>
      <footer>GTAV AUTOPORT <span>·</span> LOCAL-FIRST <span>·</span> NO GTA ONLINE SUPPORT</footer>
    </section>
  </main>;
}
