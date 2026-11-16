import test from "node:test";
import assert from "node:assert/strict";
import { createPs4TextureLayout, inspectDdsTexture, convertDdsToPs4TextureStorage, tilePs4TextureMips, untilePs4TextureMips } from "../src/core/ps4TextureLayout.js";

function dds({ width = 16, height = 16, format = "DXT1", mipCount = 1, dx10 = false } = {}) {
  const blockBytes = format === "DXT1" ? 8 : 16;
  const fourCC = dx10 ? "DX10" : format;
  const dataOffset = dx10 ? 148 : 128;
  const bytes = new Uint8Array(dataOffset + Array.from({ length: mipCount }, (_, level) => Math.ceil(Math.max(1,width>>level)/4) * Math.ceil(Math.max(1,height>>level)/4) * blockBytes).reduce((a,b)=>a+b,0));
  bytes.set([0x44,0x44,0x53,0x20]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4,124,true); view.setUint32(8,0x81007,true);
  view.setUint32(12,height,true); view.setUint32(16,width,true); view.setUint32(28,mipCount,true);
  view.setUint32(76,32,true); view.setUint32(80,4,true);
  for(let i=0;i<4;i++)bytes[84+i]=fourCC.charCodeAt(i);
  view.setUint32(112,0x1000,true);
  if(dx10){view.setUint32(128,71,true);view.setUint32(132,3,true);view.setUint32(140,1,true);}
  for(let i=dataOffset;i<bytes.length;i++)bytes[i]=(i*37+11)&255;
  return bytes;
}

test("inspects legacy BC1 DDS mip chains and calculates exact payload extents",()=>{
 const report=inspectDdsTexture(dds({width:32,height:16,format:"DXT1",mipCount:4}));
 assert.equal(report.status,"supported");assert.equal(report.format,"BC1");assert.equal(report.mipCount,4);assert.equal(report.payloadBytes,Math.ceil(32/4)*Math.ceil(16/4)*8+Math.ceil(16/4)*Math.ceil(8/4)*8+Math.ceil(8/4)*Math.ceil(4/4)*8+8);
});

test("inspects DX10 BC1 and rejects unsupported array shapes",()=>{
 const bytes=dds({width:8,height:8,dx10:true});assert.equal(inspectDdsTexture(bytes).format,"BC1");
 const view=new DataView(bytes.buffer);view.setUint32(140,2,true);assert.equal(inspectDdsTexture(bytes).status,"unsupported-texture-shape");
});

test("maps DXT5 and ATI2 DDS formats to BC3 and BC5",()=>{
 assert.equal(inspectDdsTexture(dds({format:"DXT5"})).format,"BC3");
 const bytes=dds({format:"ATI2"});assert.equal(inspectDdsTexture(bytes).format,"BC5");
});

test("rejects unsupported formats, cubemaps and truncated mip payloads",()=>{
 assert.equal(inspectDdsTexture(dds({format:"DXT3"})).status,"unsupported-format");
 const cube=dds();new DataView(cube.buffer).setUint32(112,0x200,true);assert.equal(inspectDdsTexture(cube).status,"unsupported-texture-shape");
 assert.equal(inspectDdsTexture(dds().subarray(0,130)).status,"truncated-payload");
});

test("tiles and untile mips losslessly using PS4 Thin1DThin microtiles",()=>{
 const layout=createPs4TextureLayout(36,20,4,"BC3");
 const payloads=layout.mips.map((mip,level)=>Uint8Array.from({length:mip.widthBlocks*mip.heightBlocks*layout.blockBytes},(_,i)=>(i*19+level*31)&255));
 const tiled=tilePs4TextureMips(payloads,layout);const restored=untilePs4TextureMips(tiled,layout);
 assert.equal(layout.tileMode,0x800001);assert.equal(layout.tileIndex,13);assert.equal(layout.storageBytes,tiled.length);
 for(let i=0;i<payloads.length;i++)assert.deepEqual(restored[i],payloads[i]);
});

test("automatically creates a non-installable PS4 texture storage candidate from supported DDS",()=>{
 const result=convertDdsToPs4TextureStorage(dds({width:32,height:32,format:"DXT5",mipCount:4}));
 assert.equal(result.status,"ps4-texture-storage-candidate");assert.equal(result.roundTripVerified,true);assert.equal(result.installable,false);assert.equal(result.layout.format,"BC3");
});

test("enforces dimension, mip, payload and allocation limits",()=>{
 assert.throws(()=>createPs4TextureLayout(0,16,1,"BC1"),/width and height/);
 assert.throws(()=>createPs4TextureLayout(16,16,8,"BC1"),/mip count/);
 assert.throws(()=>createPs4TextureLayout(16,16,1,"BC7"),/format/);
 assert.throws(()=>tilePs4TextureMips([new Uint8Array(1)],createPs4TextureLayout(4,4,1,"BC1")),/payload length/);
});


test("rejects DX10 sRGB and signed-normalized variants until their metadata is preserved",()=>{
 const srgb=dds({width:8,height:8,dx10:true});new DataView(srgb.buffer).setUint32(128,72,true);assert.equal(inspectDdsTexture(srgb).status,"unsupported-format");
 const snorm=dds({width:8,height:8,dx10:true});new DataView(snorm.buffer).setUint32(128,84,true);assert.equal(inspectDdsTexture(snorm).status,"unsupported-format");
});

test("requires the DDS FourCC pixel-format flag",()=>{
 const bytes=dds();new DataView(bytes.buffer).setUint32(80,0,true);assert.equal(inspectDdsTexture(bytes).status,"unsupported-pixel-format");
});
