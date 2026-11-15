import React, { useState } from "react";
import { FileSearch, AlertTriangle, CheckCircle2 } from "lucide-react";
import { inspectPs4Pkg } from "../core/ps4Pkg.js";

export default function Ps4PkgInspector() {
  const [reports, setReports] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function inspect(files) {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    try {
      const next = [];
      for (const file of Array.from(files)) next.push(await inspectPs4Pkg(file));
      setReports(next);
    } catch (err) {
      setError(err?.message || "Could not inspect the selected PKG.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel">
    <div className="panel-head">
      <div><div className="eyebrow">PS4 REFERENCE EVIDENCE</div><h3>Inspect your base-game and 1.73 PKGs</h3><p>Reads local package headers and readable PARAM.SFO metadata only. The large encrypted game payload is not uploaded or extracted.</p></div>
      <span className="tag warning"><FileSearch size={13}/> READ-ONLY</span>
    </div>
    <label className="secondary-button" style={{display:"inline-flex",cursor:"pointer",alignItems:"center",gap:8}}>
      {busy ? "Inspecting…" : "Select base-game + update PKGs"}
      <input type="file" accept=".pkg,application/octet-stream" multiple disabled={busy} onChange={event=>inspect(event.target.files)} style={{display:"none"}}/>
    </label>
    {error && <div className="audit-warning"><AlertTriangle size={14}/><span>{error}</span></div>}
    {reports.map(report=><div className="native-summary" key={report.fileName}>
      <div className="file-row"><CheckCircle2 size={15}/><span className="file-name"><b>{report.fileName}</b><small>{report.titleId || "Title ID not found"} · {report.packageType}</small></span><span className="file-ext">{(report.fileSize/1024/1024).toFixed(1)} MB</span></div>
      <div className="audit-grid">
        <div className="audit-card"><b>{report.appVersion || "—"}</b><span>App version</span></div>
        <div className="audit-card"><b>{report.category || "—"}</b><span>Package category</span></div>
        <div className="audit-card"><b>{report.requiredSystemVersion || "—"}</b><span>Required system</span></div>
        <div className="audit-card"><b>{report.entryCount}</b><span>Metadata entries</span></div>
      </div>
      <p className="native-disclaimer">Content ID: {report.contentId || "not present"}. {report.inspection}</p>
      {report.warning && <div className="audit-warning"><AlertTriangle size={14}/><span>{report.warning}</span></div>}
    </div>)}
    <div className="notice"><AlertTriangle size={18}/><div><b>Metadata inspection is not package extraction.</b><p>AutoPort does not decrypt, unpack, modify, rebuild, or install either PKG. This report alone cannot prove resource compatibility with GTA V 1.73.</p></div></div>
  </section>;
}
