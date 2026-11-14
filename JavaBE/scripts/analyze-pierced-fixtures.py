#!/usr/bin/env python3
import io,json,re,zipfile
from pathlib import Path
ROOT=Path("JavaBE/Test Addons & Mods")
JAVA=ROOT/"Pierced Animations - Serious Player Animations - 1.20.x.zip"
ADDON=ROOT/"pierced_animations_serious_playe_bedrock_port.mcaddon"
OUT=Path("fixture-analysis");OUT.mkdir(exist_ok=True)
def read_archive(data,label,depth=0):
 if depth>4:return []
 try:z=zipfile.ZipFile(io.BytesIO(data))
 except Exception:return []
 rows=[]
 for info in z.infolist():
  if info.is_dir():continue
  try:raw=z.read(info)
  except Exception:continue
  rows.append((label,info.filename,raw))
  if info.filename.lower().endswith((".zip",".jar",".mcpack",".mcaddon")):rows.extend(read_archive(raw,label+"!"+info.filename,depth+1))
 return rows
def parse_json(raw):
 try:return json.loads(raw.decode("utf-8-sig"))
 except Exception:return None
def summarize(label,rows):
 lines=["# "+label,"","Files discovered: "+str(len(rows)),""]
 for src,name,raw in rows:lines.append("- "+src+"!"+name+" — "+str(len(raw))+" bytes")
 lines += ["","## Structured Bedrock assets",""]
 for src,name,raw in rows:
  if not name.lower().endswith(".json"):continue
  obj=parse_json(raw)
  if obj is not None and any(k in name.lower() for k in ("animation","controller","entity","geometry","manifest")):
   lines += ["### "+src+"!"+name,"~~~json",json.dumps(obj,indent=2,ensure_ascii=False)[:18000],"~~~",""]
 lines += ["","## Java class names and embedded identifiers",""]
 for src,name,raw in rows:
  if not name.endswith(".class"):continue
  strings=re.findall(rb"[A-Za-z0-9_/$.:;(){}\[\]-]{5,}",raw);decoded=[]
  for item in strings:
   try:v=item.decode("utf-8")
   except Exception:continue
   if any(x in v.lower() for x in ("anim","player","pose","swing","walk","idle","attack","model","bone","render","layer","event","tick")):decoded.append(v)
  lines.append("### "+src+"!"+name);lines.extend("- "+v for v in dict.fromkeys(decoded[:100]));lines.append("")
 return "\n".join(lines)
if not JAVA.exists() or not ADDON.exists():raise SystemExit("Missing source or generated fixture")
jr=read_archive(JAVA.read_bytes(),"JAVA");ar=read_archive(ADDON.read_bytes(),"BEDROCK")
(OUT/"java-source.md").write_text(summarize("Original Java mod",jr),encoding="utf-8")
(OUT/"bedrock-port.md").write_text(summarize("Generated Bedrock port",ar),encoding="utf-8")
def inv(rows):return [{"archive":s,"path":n,"bytes":len(b),"json":parse_json(b)is not None} for s,n,b in rows]
(OUT/"inventory.json").write_text(json.dumps({"java":inv(jr),"bedrock":inv(ar)},indent=2),encoding="utf-8")
print("Analyzed "+str(len(jr))+" Java files and "+str(len(ar))+" generated Bedrock files.")
