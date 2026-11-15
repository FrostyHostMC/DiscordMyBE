import test from "node:test";
import assert from "node:assert/strict";
import { buildPedObjectPackExport, inspectPedObjectPacks } from "../src/core/pedObjectPacks.js";

const encoder = new TextEncoder();
const file = (path, source) => ({ path, bytes: encoder.encode(source), size: encoder.encode(source).length });

test("maps ped metadata to candidate model and texture resources", () => {
  const report = inspectPedObjectPacks([
    file("peds.meta", "<CPedModelInfo__InitDataList><InitDatas><Item><Name>mp_m_freemode_01</Name><txdName>mp_m_freemode_01</txdName><Pedtype>CIVMALE</Pedtype><MovementClipSet>move_m@brave</MovementClipSet><AudioNameHash>GENERIC_MALE</AudioNameHash></Item></InitDatas></CPedModelInfo__InitDataList>"),
    { path: "mp_m_freemode_01.ydd", bytes: new Uint8Array([1]), size: 1 },
    { path: "mp_m_freemode_01.ytd", bytes: new Uint8Array([2]), size: 1 },
  ]);
  assert.equal(report.summary.pedEntries, 1);
  assert.equal(report.peds[0].modelName, "mp_m_freemode_01");
  assert.equal(report.peds[0].modelCandidates[0].extension, ".ydd");
  assert.equal(report.peds[0].textureCandidates[0].extension, ".ytd");
  assert.equal(report.peds[0].dependencyStatus.model, "candidate-resolved-by-name-only");
  assert.equal(report.peds[0].runtimeDependencies.movementClipSet, "move_m@brave");
});

test("inspects object resources and spawn settings without asserting dependencies", () => {
  const report = inspectPedObjectPacks([
    { path: "props/prop_custom.ydr", bytes: new Uint8Array([1]), size: 1 },
    { path: "props/prop_custom.ytd", bytes: new Uint8Array([2]), size: 1 },
    { path: "props/prop_custom.ybn", bytes: new Uint8Array([3]), size: 1 },
    file("spawn.xml", "<SpawnConfig><Object><ModelName>prop_custom</ModelName><Position><X>1</X><Y>2</Y><Z>3</Z></Position><Heading>90</Heading><Count>2</Count></Object></SpawnConfig>"),
  ]);
  assert.equal(report.summary.objectAssetCandidates, 3);
  const config = report.spawnConfigs[0];
  assert.equal(config.valid, true);
  assert.equal(config.summary.modelReferences, 1);
  assert.equal(config.summary.positionVectors, 1);
  assert.equal(config.summary.headingFields, 1);
  assert.equal(config.summary.spawnCountFields, 1);
  assert.equal(config.modelReferences[0].resolution, "candidate-resolved-by-name-only");
  assert.deepEqual(config.modelReferences[0].resourceCandidates.sort(), ["props/prop_custom.ybn", "props/prop_custom.ydr", "props/prop_custom.ytd"]);
  assert.equal(report.objectCandidates[0].dependencyConfidence, "filename-and-pack-co-location-only");
});

test("exports analysis-only ped/object pack and rejects unrelated reports", () => {
  const report = inspectPedObjectPacks([]);
  const pack = buildPedObjectPackExport(report);
  assert.equal(pack.format, "autoport-ped-object-pack");
  assert.equal(pack.compatibility, "analysis-only-unverified");
  assert.throws(() => buildPedObjectPackExport({}), /analysis report/);
});

test("invalid ped metadata XML is reported without inventing entries", () => {
  const report = inspectPedObjectPacks([file("peds.meta", "<broken>")]);
  assert.equal(report.pedMetadataReports[0].valid, false);
  assert.equal(report.peds.length, 0);
});
