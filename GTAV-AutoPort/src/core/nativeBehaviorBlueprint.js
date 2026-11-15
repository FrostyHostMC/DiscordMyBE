const SOURCE_EXTENSIONS = new Set([".cs", ".lua", ".js"]);
const basename = (path) => path.replaceAll("\\", "/").split("/").at(-1);
const extension = (path) => { const name = basename(path); const index = name.lastIndexOf("."); return index < 0 ? "" : name.slice(index).toLowerCase(); };
const decode = (file) => new TextDecoder("utf-8", { fatal: false }).decode(file.bytes || new Uint8Array());

const API_RULES = [
  { id: "vehicle.spawn", pattern: /\b(?:CREATE_VEHICLE|CreateVehicle|World\.CreateVehicle)\b/gi, area: "vehicles", host: ["spawnVehicle", "resolveModel"] },
  { id: "ped.spawn", pattern: /\b(?:CREATE_PED|CREATE_PED_INSIDE_VEHICLE|CreatePed|World\.CreatePed)\b/gi, area: "peds", host: ["spawnPed", "resolveModel"] },
  { id: "object.spawn", pattern: /\b(?:CREATE_OBJECT|CREATE_OBJECT_NO_OFFSET|CreateProp|World\.CreateProp)\b/gi, area: "objects", host: ["spawnObject", "resolveModel"] },
  { id: "entity.transform", pattern: /\b(?:GET_ENTITY_COORDS|SET_ENTITY_COORDS|SET_ENTITY_ROTATION|SET_ENTITY_HEADING|Position|Rotation)\b/gi, area: "transforms", host: ["getEntityTransform", "setEntityTransform"] },
  { id: "ped.ai-task", pattern: /\b(?:TASK_[A-Z0-9_]+|Task[A-Z][A-Za-z0-9_]*)\b/g, area: "ped-ai", host: ["issuePedTask", "clearPedTasks"] },
  { id: "police.wanted", pattern: /\b(?:SET_PLAYER_WANTED_LEVEL|SET_MAX_WANTED_LEVEL|CLEAR_PLAYER_WANTED_LEVEL|SET_POLICE_IGNORE_PLAYER|SET_EVERYONE_IGNORE_PLAYER)\b/gi, area: "police", host: ["getWantedLevel", "setWantedLevel", "setPoliceResponse"] },
  { id: "player.reward", pattern: /\b(?:ADD_MONEY|STAT_SET_INT|GIVE_PLAYER_MONEY|GiveMoney|AddCash)\b/gi, area: "rewards", host: ["grantReward", "getPlayerBalance"] },
  { id: "weapon.grant", pattern: /\b(?:GIVE_WEAPON_TO_PED|REMOVE_WEAPON_FROM_PED|GIVE_WEAPON|GiveWeapon)\b/gi, area: "weapons", host: ["giveWeapon", "removeWeapon"] },
  { id: "entity.health", pattern: /\b(?:SET_ENTITY_HEALTH|GET_ENTITY_HEALTH|SET_PED_ARMOUR|SET_ENTITY_INVINCIBLE)\b/gi, area: "health", host: ["getHealth", "setHealth", "setArmour"] },
  { id: "effect.explosion", pattern: /\b(?:ADD_EXPLOSION|ADD_OWNED_EXPLOSION|START_PARTICLE_FX)\b/gi, area: "effects", host: ["createExplosion", "startParticleEffect"] },
  { id: "map.blip", pattern: /\b(?:ADD_BLIP_FOR_ENTITY|ADD_BLIP_FOR_COORD|SET_BLIP_\w+)\b/gi, area: "map-ui", host: ["createBlip", "configureBlip"] },
  { id: "scheduler.wait", pattern: /\b(?:WAIT|Wait|Script\.Wait|Delay)\s*\(/g, area: "scheduler", host: ["scheduleTask", "yieldFrame"] },
  { id: "input.control", pattern: /\b(?:IS_CONTROL_JUST_PRESSED|IS_CONTROL_PRESSED|IsControlJustPressed|Game\.IsControlPressed)\b/gi, area: "input", host: ["readControllerInput"] },
  { id: "interior.navigation", pattern: /\b(?:GET_INTERIOR_AT_COORDS|GET_INTERIOR_FROM_ENTITY|PIN_INTERIOR_IN_MEMORY|REQUEST_IPL|UNPIN_INTERIOR)\b/gi, area: "interiors", host: ["resolveInterior", "requestInterior", "releaseInterior"] },
];
const PC_DEPENDENCIES = [
  { id: "scripthookv", pattern: /ScriptHookV|ScriptHookVDotNet|SHVDN/i },
  { id: "nativeui", pattern: /NativeUI|UIMenu|MenuPool/i },
  { id: "dotnet", pattern: /System\.Reflection|System\.Threading|using\s+System\./i },
  { id: "lua-runtime", pattern: /Citizen\.CreateThread|Citizen\.Wait|RegisterCommand/i },
];

function excerpts(source, regex, limit = 8) {
  const found = []; let match;
  const scan = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  while ((match = scan.exec(source)) && found.length < limit) {
    const start = Math.max(0, match.index - 80); const end = Math.min(source.length, match.index + match[0].length + 100);
    found.push({ token: match[0], offset: match.index, excerpt: source.slice(start, end).replace(/\s+/g, " ").trim() });
    if (match[0].length === 0) scan.lastIndex++;
  }
  return found;
}

/** Source-level behavior inventory. It does not decompile DLLs or emit a runnable PRX. */
export function buildNativeBehaviorBlueprint(files = []) {
  const sourceFiles = files.filter((file) => SOURCE_EXTENSIONS.has(extension(file.path)));
  const modules = sourceFiles.map((file) => {
    const source = decode(file);
    const apiCalls = API_RULES.map((rule) => ({ rule, matches: excerpts(source, rule.pattern) })).filter((entry) => entry.matches.length);
    const dependencies = PC_DEPENDENCIES.filter((dependency) => dependency.pattern.test(source)).map((dependency) => dependency.id);
    const requirements = [...new Set(apiCalls.flatMap((entry) => entry.rule.host))];
    return { path: file.path, language: extension(file.path).slice(1), sourceBytes: file.size ?? file.bytes?.byteLength ?? 0, dependencies, detectedBehaviors: apiCalls.map((entry) => ({ id: entry.rule.id, area: entry.rule.area, occurrenceCount: entry.matches.length, evidence: entry.matches })), requiredNativeHostApis: requirements, unclassifiedSourceBytes: Math.max(0, source.length - apiCalls.reduce((sum, entry) => sum + entry.matches.reduce((n, match) => n + match.token.length, 0))) };
  });
  const behaviors = new Map();
  for (const module of modules) for (const behavior of module.detectedBehaviors) {
    if (!behaviors.has(behavior.id)) behaviors.set(behavior.id, { id: behavior.id, area: behavior.area, occurrences: 0, evidence: [] });
    const current = behaviors.get(behavior.id); current.occurrences += behavior.occurrenceCount; current.evidence.push(...behavior.evidence.slice(0, 4));
  }
  const requiredNativeHostApis = [...new Set(modules.flatMap((module) => module.requiredNativeHostApis))].sort();
  return { schemaVersion: 1, kind: "native-behavior-blueprint", modules, behaviors: [...behaviors.values()], requiredNativeHostApis, summary: { sourceFiles: modules.length, behaviorTypes: behaviors.size, detectedOccurrences: [...behaviors.values()].reduce((sum, item) => sum + item.occurrences, 0), pcRuntimeDependencies: [...new Set(modules.flatMap((module) => module.dependencies))], nativeHostApis: requiredNativeHostApis.length }, target: { titleId: "CUSA00419", updateVersion: "1.73", runtime: "GoldHEN Orbis PRX", implementationStatus: "blueprint-only" }, limitations: ["Static source pattern matches are evidence candidates, not full control-flow analysis.", "Compiled ASI/DLL files cannot be reconstructed from their filenames or PE headers; editable source or a documented behavior specification is required.", "PC framework APIs, threading, UI and ScriptHookV calls must be replaced with PS4-native equivalents.", "No Orbis PRX is compiled and no game-native address or hook is assumed safe for GTA V 1.73."] };
}
