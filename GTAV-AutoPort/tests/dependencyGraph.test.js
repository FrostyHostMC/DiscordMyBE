import test from "node:test";
import assert from "node:assert/strict";
import { buildVehicleDependencyGraph } from "../src/core/dependencyGraph.js";

const file=(path,extension,size=10)=>({path,extension,size});

test("classifies a mixed vehicle mod inventory without model-specific assumptions",()=>{
  const graph=buildVehicleDependencyGraph({files:[
    file("vehicles.meta",".meta"),file("handling.meta",".meta"),
    file("cars/custom.yft",".yft"),file("cars/custom_hi.yft",".yft"),
    file("shared/custom_textures.ytd",".ytd"),file("cars/custom.ybn",".ybn"),
    file("readme.txt",".txt")
  ]});
  assert.equal(graph.summary.fileCount,7);
  assert.equal(graph.summary.resourceTypeCounts["vehicle-fragment"],2);
  assert.equal(graph.summary.resourceTypeCounts["texture-dictionary"],1);
  assert.equal(graph.summary.resourceTypeCounts.collision,1);
  assert.equal(graph.scope,"inventory-and-explicit-vehicle-metadata-references");
});

test("resolves explicit model and texture dependencies independent of vehicle name",()=>{
  const metadata={dependencies:{modelFiles:["examplecar.yft","examplecar_hi.yft"],textureFiles:["example_textures.ytd"]}};
  const graph=buildVehicleDependencyGraph({files:[
    file("examplecar.yft",".yft"),file("examplecar_hi.yft",".yft"),file("example_textures.ytd",".ytd"),file("handling.meta",".meta")
  ],metadata});
  assert.equal(graph.summary.resolved,3);
  assert.equal(graph.summary.missing,0);
  assert.equal(graph.summary.ambiguous,0);
  assert.equal(graph.edges.length,3);
});

test("reports missing and ambiguous dependencies instead of guessing",()=>{
  const metadata={dependencies:{modelFiles:["car.yft"],textureFiles:["car.ytd"]}};
  const graph=buildVehicleDependencyGraph({files:[
    file("one/car.yft",".yft"),file("two/car.yft",".yft")
  ],metadata});
  assert.equal(graph.summary.ambiguous,1);
  assert.equal(graph.summary.missing,2);
  assert.equal(graph.dependencies.find((item)=>item.kind==="model").status,"ambiguous");
});

test("inventory graph records its intentionally incomplete scope",()=>{
  const graph=buildVehicleDependencyGraph({files:[]});
  assert.ok(graph.limitations.some((item)=>item.includes("not a complete GTA V DLC/archive dependency resolver")));
});
