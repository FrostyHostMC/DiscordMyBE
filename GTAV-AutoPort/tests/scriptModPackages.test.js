import test from "node:test";
import assert from "node:assert/strict";
import { inspectScriptModPackages } from "../src/core/scriptModPackages.js";

const encoder = new TextEncoder();
const file = (path, value) => ({ path, bytes: encoder.encode(value), size: encoder.encode(value).length });

test("groups Home Invasion-style DLL and XML and separates data from runtime behavior", () => {
  const report = inspectScriptModPackages([
    file("HomeInvasion/HomeInvasion.dll", "MZ"),
    file("HomeInvasion/HomeInvasion.xml", "<Settings><HomeType>6</HomeType><House><Position><X>1</X><Y>2</Y><Z>3</Z></Position></House><Markers>true</Markers><PoliceAlerts>true</PoliceAlerts><PlayerMasks>true</PlayerMasks></Settings>"),
    file("HomeInvasion/readme.txt", "ignored"),
  ]);
  assert.equal(report.summary.packageCount, 1);
  assert.equal(report.summary.pcRuntimeFiles, 1);
  assert.equal(report.summary.xmlFiles, 1);
  const pkg = report.packages[0];
  assert.equal(pkg.classification, "scripted-gameplay-mod");
  assert.equal(pkg.requiresNativeReimplementation, true);
  assert.equal(pkg.xmlReports[0].validXml, true);
  assert.equal(pkg.xmlReports[0].signals.homeTypeFields, 1);
  assert.equal(pkg.xmlReports[0].signals.houseOrLocationEntries, 1);
  assert.equal(pkg.behaviorPortStatus, "not-ported-native-runtime-required");
});

test("does not classify an unrelated console PRX and config as a PC DLL port", () => {
  const report = inspectScriptModPackages([
    file("Menu/CustomPlugin.prx", "SELF"),
    file("Menu/config.xml", "<Config><Option>true</Option></Config>"),
  ]);
  assert.equal(report.summary.consolePlugins, 1);
  assert.equal(report.summary.pcRuntimeFiles, 0);
  assert.equal(report.packages[0].requiresNativeReimplementation, false);
});

test("ignores folders containing config only and no runtime file", () => {
  const report = inspectScriptModPackages([file("Cars/vehicle.xml", "<Vehicle/>")]);
  assert.equal(report.summary.packageCount, 0);
});
