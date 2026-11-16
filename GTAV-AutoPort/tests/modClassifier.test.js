import test from "node:test";
import assert from "node:assert/strict";
import { auditModFiles } from "../src/core/modClassifier.js";
import "../src/core/registeredFormatAdapters.js";
const f=(path,bytes=new Uint8Array(),size=bytes.length)=>({path,extension:path.includes(".")?path.slice(path.lastIndexOf(".")).toLowerCase():"",bytes,size});
test("classifies broad GTA V resource families without assuming vehicles",()=>{const r=auditModFiles([f("stream/interior.ydr"),f("stream/interior.ybn"),f("stream/interior.ytd"),f("stream/interior.ymap"),f("stream/interior.ytyp"),f("anim/dance.ycd"),f("audio/sounds.awc"),f("scripts/ped.ysc")]);assert.equal(r.summary.fileCount,8);assert.equal(r.summary.familyCounts["rage-resource"],6);assert.equal(r.summary.familyCounts["audio-resource"],1);assert.equal(r.summary.familyCounts["game-script"],1);});
test("flags PC native plugins as not directly portable",()=>{const r=auditModFiles([f("plugins/ScriptHookV.dll"),f("plugins/trainer.asi"),f("tool.exe")]);assert.equal(r.summary.pcNativePlugins,3);assert.equal(r.summary.attentionCount,3);assert.ok(r.warnings.every(w=>w.message.includes("Windows/PC native code")));});
test("recognizes console plugin files but requires target build validation",()=>{const r=auditModFiles([f("plugin.prx")]);assert.equal(r.files[0].family,"console-native-plugin");assert.equal(r.files[0].portability,"target-build-validation-required");});
test("detects signatures independently from file extensions",()=>{const r=auditModFiles([f("odd.data",new Uint8Array([0x4d,0x5a,0x90,0]))]);assert.equal(r.files[0].signature,"MZ");assert.equal(r.files[0].family,"pc-native-plugin");assert.equal(r.files[0].portability,"not-directly-portable");assert.ok(r.warnings.some(w=>w.message.includes("Windows PE")));});
test("keeps unknown files visible instead of discarding them",()=>{const r=auditModFiles([f("custom/opaque.bin")]);assert.equal(r.files[0].family,"unknown");assert.equal(r.summary.unknownFiles,1);assert.equal(r.files[0].path,"custom/opaque.bin");});
test("detects common texture and audio source files",()=>{const r=auditModFiles([f("body.fbx"),f("skin.dds"),f("theme.wav")]);assert.deepEqual(r.files.map(x=>x.family),["3d-source","texture-source","audio-source"]);});

test("attaches evidence-based adapter detection to every imported binary",()=>{const r=auditModFiles([f("mystery.bin",new Uint8Array([0x37,0x46,0x50,0x52,1,0,0,0])),f("wrong-extension.dat",new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))]);assert.equal(r.files[0].signature,"RPF7");assert.equal(r.files[0].formatDetection.status,"recognized");assert.equal(r.files[0].formatDetection.selectedAdapterId,"rage-rpf7");assert.equal(r.files[0].formatDetection.conversionAuthorized,false);assert.equal(r.files[1].signature,"PNG");assert.equal(r.files[1].formatDetection.selectedAdapterId,"png");});
test("does not treat a file extension as proof of binary format",()=>{const r=auditModFiles([f("archive.rpf",new Uint8Array([0,1,2,3]))]);assert.equal(r.files[0].family,"archive");assert.equal(r.files[0].signature,null);assert.equal(r.files[0].formatDetection.status,"unrecognized");assert.equal(r.files[0].formatDetection.preservedAsSource,true);});

test("infers an unknown extension family from a recognized content signature",()=>{const r=auditModFiles([f("opaque.payload",new Uint8Array([0x52,0x53,0x43,0x37,1,2,3,4])),f("binary.data",new Uint8Array([0x4d,0x5a,0x90,0]))]);assert.equal(r.files[0].family,"rage-resource");assert.equal(r.files[0].classificationBasis,"content-signature");assert.equal(r.files[1].family,"pc-native-plugin");assert.equal(r.files[1].portability,"not-directly-portable");assert.ok(r.files[1].warnings.some(w=>w.includes("Windows/PC native code")));});

test("handles Windows-style paths and flags extension/signature conflicts",()=>{const r=auditModFiles([f("stream\\\\asset.ytd",new Uint8Array([0x44,0x44,0x53,0x20])),f("textures\\\\asset.png",new Uint8Array([0x52,0x53,0x43,0x37]))]);assert.equal(r.files[0].extension,".ytd");assert.equal(r.files[0].signature,"DDS");assert.ok(r.files[0].warnings.some(w=>w.includes("does not agree")));assert.equal(r.files[1].extension,".png");assert.equal(r.files[1].signature,"RSC7");assert.ok(r.files[1].warnings.some(w=>w.includes("does not agree")));});


test("detects Windows PE binaries masquerading as PRX files",()=>{const bytes=new Uint8Array(512);const v=new DataView(bytes.buffer);bytes.set([0x4d,0x5a]);v.setUint32(0x3c,0x80,true);v.setUint32(0x80,0x00004550,true);v.setUint16(0x84,0x8664,true);v.setUint16(0x86,2,true);v.setUint16(0x94,0xf0,true);v.setUint16(0x98,0x20b,true);const r=auditModFiles([f("plugins/not-really-a-prx.prx",bytes)]);assert.equal(r.files[0].binaryInspection.format,"pe");assert.ok(r.files[0].warnings.some(w=>w.includes("Windows PE image inside a PRX/SPRX-named file")));});

test("reports PS4 CPU architecture evidence without claiming an ELF plugin is compatible",()=>{const bytes=new Uint8Array(128);bytes.set([0x7f,0x45,0x4c,0x46,2,1,1,9]);const v=new DataView(bytes.buffer);v.setUint16(16,3,true);v.setUint16(18,62,true);v.setUint32(20,1,true);v.setUint16(52,64,true);const r=auditModFiles([f("plugins/candidate.sprx",bytes)]);assert.equal(r.files[0].binaryInspection.machineName,"x86-64");assert.equal(r.files[0].binaryInspection.architectureCompatibleWithPs4Cpu,true);assert.equal(r.files[0].binaryInspection.targetCompatibility,"unverified");assert.ok(r.files[0].warnings.some(w=>w.includes("Orbis ABI")));});


test("classifies DDS content as a partial PS4 texture candidate without an extension conflict",()=>{
 const r=auditModFiles([f("textures/vehicle.dds",new Uint8Array([0x44,0x44,0x53,0x20]))]);
 assert.equal(r.files[0].family,"texture-source");
 assert.equal(r.files[0].formatDetection.selectedAdapterId,"ps4-thin1dthin-dds-storage");
 assert.ok(r.files[0].warnings.some(w=>w.includes("partial PS4 texture-storage payload")));
 assert.ok(!r.files[0].warnings.some(w=>w.includes("does not agree")));
});

test("infers a compressed texture family from DDS content without a known extension",()=>{
 const r=auditModFiles([f("payload/opaque.bin",new Uint8Array([0x44,0x44,0x53,0x20]))]);
 assert.equal(r.files[0].family,"texture-source");
 assert.equal(r.files[0].classificationBasis,"content-signature");
 assert.equal(r.files[0].formatDetection.selectedAdapterId,"ps4-thin1dthin-dds-storage");
});


test("classifies SPRX files as console-native plugins and inspects their SELF signature",()=>{
 const r=auditModFiles([f("plugins/graphics.sprx",new Uint8Array([0x4f,0x15,0x3d,0x1d,0,0,0,0]))]);
 assert.equal(r.files[0].family,"console-native-plugin");
 assert.equal(r.files[0].binaryInspection.format,"self-container");
 assert.equal(r.files[0].binaryInspection.targetCompatibility,"unverified");
});
