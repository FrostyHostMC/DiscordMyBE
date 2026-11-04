import React, { useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Search, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';

type Topic = { id: string; title: string; intro: string; points: string[] };
const topics: Topic[] = [
{ id:'start', title:'Getting started', intro:'The normal path from imported add-ons to a finished modpack.', points:[
'Open Merge Workspace and import .mcpack, .mcaddon, or .zip files. You can also choose a folder containing add-on files.',
'Check the imported list. Behavior Packs contain gameplay content; Resource Packs contain visuals, sounds, and other client content.',
'Select the packs you want included. Unselected packs stay in your library and are not included in this build.',
'Choose Analyze or start the merge. Review any conflicts that need a decision, then confirm the output plan.',
'If a pack offers subpack variants, choose one option for each listed pack. Only the chosen variant is included.',
'When the merge finishes, download the combined .mcaddon for the complete result, or download an individual .mcpack.'
]},
{ id:'import', title:'Importing and duplicate packs', intro:'What AutoBE reads when you add files.', points:[
'.mcpack normally contains one Bedrock pack. .mcaddon can contain multiple packs. .zip is checked for Bedrock manifests and supported nested archives.',
'AutoBE reads the manifest to identify the pack name, type, version, requirements, scripts, and available subpack choices.',
'A behavior pack and its resource pack may appear as two separate library entries. Include both if you want gameplay and visuals.',
'Matching pack IDs and pack types are treated as duplicates and skipped. If you need to replace an older copy, remove it from the library and import the updated file.',
'Java Edition .jar mods are not Bedrock add-ons and cannot be made compatible by renaming the file.'
]},
{ id:'selection', title:'Selecting packs and the workspace', intro:'How selection affects a build.', points:[
'A selected pack is included in the next merge. Clearing selection does not delete anything.',
'All, BP, and RP filter the list. Search finds packs by name. Select All and Deselect All change the current selection.',
'Delete All removes source packs from the workspace library. It is not the same as deselecting them and it does not delete saved merged projects.',
'The up/down controls display pack priority. When different add-ons provide the same file, the active version can depend on how that conflict is handled; review the conflict result instead of assuming every file follows one universal rule.'
]},
{ id:'types', title:'Behavior Packs and Resource Packs', intro:'Why one modpack can contain several output files.', points:[
'Behavior Packs contain gameplay definitions such as entities, items, blocks, recipes, loot tables, functions, and scripts.',
'Resource Packs contain textures, sounds, models, render controllers, and other visual content.',
'AutoBE builds resource content separately from behavior content because Minecraft loads these pack types independently.',
'One modpack may contain one resource output and multiple behavior outputs. That is expected when scripted packs need separate groups.'
]},
{ id:'conflicts', title:'Conflicts and resolution choices', intro:'What the choices mean before you continue.', points:[
'A conflict means two selected add-ons define the same kind of content or provide different files for the same location.',
'Prefix & Keep Both attempts to give a supported custom identifier a unique name and update references AutoBE recognizes. It cannot guarantee every possible reference or script is rewritten.',
'Keep Pack A or Keep Pack B chooses which version remains active for that finding. It does not delete either original add-on from your library.',
'Vanilla asset conflicts cannot safely be renamed because Minecraft expects those built-in paths. Choose which add-on’s file should remain active.',
'The vanilla player definition is special and cannot be safely fixed by prefixing. Compatible additions may be combined; conflicting alternatives may be saved for review.',
'When two different files cannot be safely combined, AutoBE can keep one active and store the other in a conflict-review folder. Those backup files are not active Minecraft content.'
]},
{ id:'automatic', title:'Automatic conflict handling', intro:'What AutoBE can decide automatically.', points:[
'Automatic conflict handling can prefix supported custom identifier conflicts instead of asking you to choose each one.',
'Vanilla asset choices still require a decision. Special player definitions and incompatible file contents may also need review.',
'The Conflict Analyzer can be opened from the workspace. Expand a finding to read its explanation and compare versions where available.'
]},
{ id:'scripts', title:'Scripts and Script API versions', intro:'Why scripted add-ons may create separate behavior outputs.', points:[
'AutoBE reads the script module and Script API version declared by each behavior pack.',
'Non-scripted behavior packs can be grouped into a data-only behavior output. Scripted packs with different major @minecraft/server versions are placed in separate behavior outputs.',
'All of those outputs belong to the same modpack. Import the complete .mcaddon to include them together.',
'Scripts can depend on Minecraft versions, other files, and runtime behavior that archive inspection cannot fully prove. A successful build does not guarantee every script works.',
'If AutoBE reports shared script runtime properties, multiple scripts may write to the same game property. The report warns that the last write can determine the result.'
]},
{ id:'subpacks', title:'Subpacks and variants', intro:'Choosing between alternate versions inside one add-on.', points:[
'Some add-ons include several variants, such as different resolutions or feature sets.',
'Choose one variant for each pack shown. Only the selected variant is included; the other variants are left out to avoid duplicate content.',
'Canceling the prompt stops that merge attempt. You can start again when ready.'
]},
{ id:'outputs', title:'Understanding downloads and results', intro:'Which file should you install?', points:[
'The combined .mcaddon is the easiest option for installing the complete result. It contains the generated .mcpack outputs and AutoBE report files.',
'An individual .mcpack contains only one generated output. Use it when you intentionally want only that part.',
'Resource Pack contains visual content. Behavior (Data) contains behavior content without scripts. Behavior (Script API vN) contains scripted behavior packs grouped by detected Script API major version.',
'Counts and sizes describe the generated archive. They do not prove that every feature has been tested inside Minecraft.',
'AutoBE may create a valid output while also reporting warnings or conflicts. Read the findings before using the pack.'
]},
{ id:'originals', title:'Keeping your original add-ons', intro:'Source add-ons and merged projects are separate.', points:[
'Building a modpack creates a new project. It does not overwrite the imported source add-ons.',
'Source add-ons remain in your library after a merge so you can reuse them. Removing a source pack from the library is separate from deleting a saved merged project.',
'Local saving and cloud backup are separate. A message that a pack was saved on this device does not mean its cloud backup completed.'
]},
{ id:'test', title:'Test safely in Minecraft', intro:'Check the result before using it in an important world.', points:[
'Import the combined .mcaddon into Minecraft Bedrock.',
'Create a copy of the world you want to use. Activate the generated behavior and resource packs as needed.',
'Check the features that matter: items, recipes, entities, textures, animations, sounds, and scripts.',
'If something is missing, inspect the AutoBE diagnostics included in the bundle and Minecraft’s Content Log.',
'Never test an unverified merged pack in the only copy of an important world.'
]},
{ id:'trouble', title:'Common problems', intro:'What common messages usually mean.', points:[
'No valid Bedrock manifest: the selected archive may not be a Bedrock add-on, or its manifest may be nested too deeply. Try importing the actual .mcpack or .mcaddon.',
'Duplicate skipped: a matching pack ID and type already exist in the library.',
'Missing script entry: a pack declares a script module, but AutoBE could not confidently locate its starting JavaScript file. Re-download the complete add-on.',
'Cloud backup failed: your local copy may still be saved. Keep the original file and retry backup later.',
'A feature does not work in Minecraft: review AutoBE findings and Minecraft Content Log. Some add-on problems only appear while the game runs.',
'Download did not start: retry and allow the Discord or browser download prompt if one appears. Large files may take longer.'
]}
];

export const HelpCenterScreen: React.FC<{ onBack: () => void }> = ({ onBack }) => {
 const [query,setQuery]=useState('');
 const [expanded,setExpanded]=useState('start');
 const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return q?topics.filter(t=>(t.title+' '+t.intro+' '+t.points.join(' ')).toLowerCase().includes(q)):topics;},[query]);
 return <div className="flex flex-col h-full min-h-0 bg-[#08070D] text-white overflow-hidden">
  <header className="shrink-0 px-4 sm:px-6 py-3.5 border-b border-[#30263F]/70 bg-[#100D18]">
   <div className="flex items-center gap-3">
    <button type="button" onClick={onBack} className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-[#15111F] border border-[#30263F] text-[#AAA3BB] hover:text-white"><ArrowLeft className="w-4 h-4"/><span className="text-xs font-semibold">Back</span></button>
    <div><div className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-[#A855F7]"/><h1 className="text-base font-bold">AutoBE Help Center</h1></div><p className="text-[11px] text-[#AAA3BB] mt-0.5">Learn how to import, combine, and use Bedrock add-ons.</p></div>
   </div>
   <div className="relative mt-3"><Search className="w-4 h-4 text-[#AAA3BB] absolute left-3 top-1/2 -translate-y-1/2"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search help topics..." className="w-full bg-[#08070D] border border-[#30263F] rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none focus:border-[#762BFF]"/></div>
  </header>
  <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 pb-10 space-y-3 max-w-4xl mx-auto w-full" style={{WebkitOverflowScrolling:'touch'}}>
   <div className="p-4 rounded-2xl bg-[#100D18] border border-[#762BFF]/35"><h2 className="text-sm font-bold">Welcome to AutoBE</h2><p className="text-xs text-[#AAA3BB] leading-relaxed mt-1">AutoBE combines Minecraft Bedrock behavior and resource add-ons into downloadable modpacks. This guide explains the choices you see and what they mean.</p></div>
   {filtered.length===0?<p className="p-8 text-center rounded-xl bg-[#100D18] border border-[#30263F] text-sm text-[#AAA3BB]">No matching topics. Try “conflicts”, “scripts”, or “download”.</p>:filtered.map(topic=>{const open=!!query||expanded===topic.id;return <section key={topic.id} className="rounded-xl bg-[#100D18] border border-[#30263F] overflow-hidden">
    <button type="button" onClick={()=>setExpanded(open&&!query?'':topic.id)} aria-expanded={open} className="w-full flex items-center justify-between gap-3 text-left p-4 hover:bg-[#15111F]/70"><span><span className="block text-sm font-bold">{topic.title}</span><span className="block text-xs text-[#AAA3BB] mt-1">{topic.intro}</span></span>{open?<ChevronUp className="w-4 h-4 text-[#A855F7] shrink-0"/>:<ChevronDown className="w-4 h-4 text-[#AAA3BB] shrink-0"/>}</button>
    {open&&<ol className="px-4 pb-4 pt-3 border-t border-[#30263F]/70 space-y-2.5">{topic.points.map((p,i)=><li key={i} className="flex gap-2.5 text-xs text-[#C7C0D4] leading-relaxed"><span className="w-5 h-5 rounded-md bg-[#762BFF]/15 text-[#C9A9FF] text-[10px] font-bold flex items-center justify-center shrink-0">{i+1}</span><span>{p}</span></li>)}</ol>}
   </section>})}
   <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/25"><div className="flex items-center gap-2 text-xs font-bold text-amber-200"><AlertTriangle className="w-4 h-4"/>Important</div><p className="text-xs text-amber-100/80 leading-relaxed mt-1.5">A successful build means AutoBE created an output and completed the checks it performs. It does not prove every feature works in every Minecraft version. Test in a copy of your world first.</p></div>
  </main>
 </div>;
};
