import React from "react";
import { ArrowDownToLine, CarFront, FileArchive, ShieldCheck, Wrench } from "lucide-react";

const stages = [
  ["01", "Import PC mod", "Archive intake and file inventory"],
  ["02", "Analyze vehicle", "Metadata, models, textures, dependencies"],
  ["03", "Convert assets", "Format-specific PS4 conversion adapters"],
  ["04", "Validate target", "Title ID, game build, references and paths"],
  ["05", "Build outputs", "Loose files and deployment package"],
];

export default function App() {
  return <main className="shell">
    <aside className="rail">
      <div className="brand"><span className="brand-mark"><CarFront size={19}/></span><span>AutoPort</span></div>
      <div className="rail-label">WORKSPACE</div>
      <div className="nav active"><FileArchive size={17}/> Mod Converter</div>
      <div className="rail-label">TOOLS</div>
      <div className="nav"><Wrench size={17}/> Format Engines</div>
      <div className="nav"><ShieldCheck size={17}/> Compatibility</div>
      <div className="rail-foot">LOCAL WORKSPACE<br/><b>PS4 · STORY MODE</b></div>
    </aside>
    <section className="content">
      <header><div><div className="eyebrow">GTAV AUTO PORT / WORKSPACE</div><h1>Vehicle conversion</h1><p>Move supported PC vehicle mods toward a validated PS4 Story Mode package.</p></div><div className="status"><i/> DEVELOPMENT BUILD</div></header>
      <section className="hero">
        <div className="hero-copy"><div className="eyebrow">FIRST TARGET</div><h2>PC vehicle → PS4 Story Mode</h2><p>Start with a single replacement vehicle. AutoPort will inspect metadata, identify dependencies, and report exactly what still needs conversion.</p><button disabled><ArrowDownToLine size={16}/> Import mod <span>COMING NEXT</span></button></div>
        <div className="hero-art"><div className="orb orb-one"/><div className="orb orb-two"/><CarFront size={112} strokeWidth={1.05}/><span>VEHICLE PIPELINE</span></div>
      </section>
      <div className="section-head"><div><div className="eyebrow">WORKFLOW</div><h3>Conversion pipeline</h3></div><span className="muted">5 stages</span></div>
      <div className="stages">{stages.map(([n,title,desc])=><article className="stage" key={n}><div className="stage-number">{n}</div><h4>{title}</h4><p>{desc}</p><span className="stage-state">{n==="01"?"NEXT UP":"PLANNED"}</span></article>)}</div>
      <div className="notice"><ShieldCheck size={19}/><div><b>Conversion status is reported honestly</b><p>PC YFT/YTD assets are not PS4-ready just because they can be copied or repacked. Deployment stays locked until a tested converter and exact game-build validation are in place.</p></div></div>
      <footer>GTAV AUTOPORT <span>·</span> LOCAL-FIRST <span>·</span> NO GTA ONLINE SUPPORT</footer>
    </section>
  </main>;
}
