#!/usr/bin/env python3
import argparse,datetime
from xml.sax.saxutils import quoteattr
def tree(paths):
 r={}
 for p in paths:
  n=r
  for q in p.split("/")[:-1]:n=n.setdefault(q,{})
 return r
def emit(n,d,o):
 for k in sorted(n):
  pad="\t"*d
  if n[k]:o.append("%s<dir targ_name=%s>"%(pad,quoteattr(k)));emit(n[k],d+1,o);o.append("%s</dir>"%pad)
  else:o.append("%s<dir targ_name=%s />"%(pad,quoteattr(k)))
def main():
 p=argparse.ArgumentParser();p.add_argument("--out",required=True);p.add_argument("--content-id",required=True);p.add_argument("files",nargs="+");a=p.parse_args();fs=[x.replace("\\\\","/") for x in a.files]
 x=['<?xml version="1.0"?>','<psproject xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" fmt="gp4" version="1000">',"<volume>","<volume_type>pkg_ps4_app</volume_type>","<volume_id>PS4VOLUME</volume_id>","<volume_ts>%s</volume_ts>"%datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),'<package content_id=%s passcode="00000000000000000000000000000000" storage_type="digital50" app_type="full" />'%quoteattr(a.content_id),'<chunk_info chunk_count="1" scenario_count="1"><chunks><chunk id="0" layer_no="0" label="Chunk #0" /></chunks><scenarios><scenario id="0" type="sp" initial_chunk_count="1" label="Scenario #0">0</scenario></scenarios></chunk_info>',"</volume>",'<files img_no="0">']
 for f in fs:x.append('<file targ_path=%s orig_path=%s />'%(quoteattr(f),quoteattr(f)))
 x.extend(["</files>","<rootdir>"]);emit(tree(fs),1,x);x.extend(["</rootdir>","</psproject>"])
 with open(a.out,"w") as f:f.write("\n".join(x)+"\n")
if __name__=="__main__":main()
