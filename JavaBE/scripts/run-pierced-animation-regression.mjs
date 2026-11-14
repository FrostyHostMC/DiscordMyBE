import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'Test Addons & Mods', 'Pierced Animations - Serious Player Animations - 1.20.x.zip');
const reportDir = path.resolve(root, '..', 'fixture-analysis');
fs.mkdirSync(reportDir, { recursive: true });

if (!fs.existsSync(sourcePath)) throw new Error(`Pierced source fixture is missing: ${sourcePath}`);

const server = await createServer({
  configFile: path.join(root, 'vite.config.ts'),
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const { readZipArchive } = await server.ssrLoadModule('/src/utils/zip.ts');
  const { portMobAndPlayerAnimations } = await server.ssrLoadModule('/src/utils/animationPortEngine.ts');
  const { setPlayableMode } = await server.ssrLoadModule('/src/utils/provenance.ts');
  const { resolvePlayerDependencies } = await server.ssrLoadModule('/src/utils/playerDependencyResolver.ts');
  const { guaranteePlayerBaselineWiring } = await server.ssrLoadModule('/src/utils/playerBaselineGuard.ts');

  setPlayableMode(false);
  const archiveBytes = new Uint8Array(fs.readFileSync(sourcePath));
  const entries = await readZipArchive(archiveBytes, {
    maxEntries: 5000,
    maxEntryBytes: 128 * 1024 * 1024,
    maxTotalBytes: 256 * 1024 * 1024,
  });

  const decoder = new TextDecoder();
  const sourceClipIds = [];
  for (const entry of entries) {
    if (entry.isDirectory || !/\.json$/i.test(entry.path)) continue;
    if (!/player_animation/i.test(entry.path)) continue;
    try {
      const document = JSON.parse(decoder.decode(entry.data));
      if (document.animations && typeof document.animations === 'object') {
        sourceClipIds.push(...Object.keys(document.animations));
      }
    } catch {
      // The converter's own parser reports malformed source documents.
    }
  }

  const logs = [];
  const result = portMobAndPlayerAnimations(
    'pierced_fixture',
    'Pierced Animations fixture',
    [],
    entries,
    (line) => logs.push(line),
    new Map(),
    undefined,
    [],
  );

  // Merge the exact player wiring output before applying the same dependency repairs used by export.
  Object.assign(result.resourcePackFiles, result.playerWiringFiles ?? {});
  const playerDependencies = resolvePlayerDependencies({
    modId: 'pierced_fixture',
    resourcePackFiles: result.resourcePackFiles,
    behaviorPackFiles: result.behaviorPackFiles,
    onLog: (line) => logs.push(line),
  });
  const baselineGuard = guaranteePlayerBaselineWiring({
    resourcePackFiles: result.resourcePackFiles,
    onLog: (line) => logs.push(line),
  });

  const emittedClipIds = [];
  const duplicateDefinitions = [];
  const seenDefinitions = new Map();
  for (const [file, raw] of Object.entries(result.resourcePackFiles)) {
    if (typeof raw !== 'string' || !/\.animation\.json$/i.test(file)) continue;
    try {
      const document = JSON.parse(raw);
      for (const id of Object.keys(document.animations ?? {})) {
        emittedClipIds.push(id);
        const previous = seenDefinitions.get(id);
        if (previous) duplicateDefinitions.push({ id, files: [previous, file] });
        else seenDefinitions.set(id, file);
      }
    } catch {
      // Invalid generated JSON is caught by the assertions below only if it contains expected clips.
    }
  }

  const playerPath = Object.keys(result.resourcePackFiles).find((file) => {
    if (!/\.entity\.json$/i.test(file)) return false;
    try {
      const document = JSON.parse(result.resourcePackFiles[file]);
      return document?.['minecraft:client_entity']?.description?.identifier === 'minecraft:player';
    } catch {
      return false;
    }
  });
  const playerDocument = playerPath ? JSON.parse(result.resourcePackFiles[playerPath]) : null;
  const playerDescription = playerDocument?.['minecraft:client_entity']?.description;
  const preAnimation = playerDescription?.scripts?.pre_animation;
  const assignments = Array.isArray(preAnimation) ? preAnimation : typeof preAnimation === 'string' ? [preAnimation] : [];
  const initializeRaw = playerDescription?.scripts?.initialize;
  const initialize = Array.isArray(initializeRaw) ? initializeRaw : typeof initializeRaw === 'string' ? [initializeRaw] : [];
  const tcos0 = assignments.find((line) => /^variable\.tcos0\s*=/.test(line));
  const spear = assignments.find((line) => /^variable\.melee_spear_equipped\s*=/.test(line));
  const sourceMovementVariables = ['spa_move_speed', 'spa_moving_backwards', 'spa_turn_delta', 'spa_previous_body_yaw'];
  const controllerFiles = Object.entries(result.resourcePackFiles)
    .filter(([file, raw]) => typeof raw === 'string' && /^animation_controllers\/pierced_fixture(?:_overlay)?\.player\.animation_controllers\.json$/i.test(file))
    .map(([file, raw]) => ({ file, doc: JSON.parse(raw) }));
  const controllerStateClips = controllerFiles.map(({ file, doc }) => ({
    file,
    clips: Object.values(doc.animation_controllers ?? {}).flatMap((controller) =>
      Object.values(controller.states ?? {}).flatMap((state) => Array.isArray(state.animations) ? state.animations : []),
    ),
  }));
  const baseControllerClips = controllerStateClips.find((entry) => !entry.file.includes('_overlay'))?.clips ?? [];
  const overlayControllerClips = controllerStateClips.find((entry) => entry.file.includes('_overlay'))?.clips ?? [];
  const invalidArmorQueries = Object.entries(result.resourcePackFiles)
    .filter(([, raw]) => typeof raw === 'string')
    .flatMap(([file, raw]) => [...raw.matchAll(/query\.get_equipped_item_name\(\s*['"]slot\.armor[^)]*\)/gi)].map((match) => ({ file, call: match[0] })));

  const wiring = result.playerEntityWiring;
  const triggers = result.playerTriggerReport;
  const playerPort = result.playerAnimationPort?.report;
  const assertions = [
    { id: 'source-fixture-has-nine-animation-definitions', expected: 9, actual: sourceClipIds.length, passed: sourceClipIds.length === 9 },
    { id: 'player-animation-bridge-inspected-every-source-clip', expected: sourceClipIds.length, actual: playerPort?.clipsInspected ?? 0, passed: Boolean(playerPort && playerPort.clipsInspected === sourceClipIds.length) },
    { id: 'all-source-clips-registered-on-player', expected: sourceClipIds.length, actual: wiring?.clipsRegistered ?? 0, passed: Boolean(wiring && wiring.clipsRegistered === sourceClipIds.length) },
    { id: 'serious-player-animations-source-profile-recognized', expected: 'Serious Player Animations 1.1.1', actual: triggers?.sourceProfile ?? 'missing', passed: triggers?.sourceProfile === 'Serious Player Animations 1.1.1' },
    { id: 'six-source-locomotion-clips-mapped', expected: 6, actual: triggers?.mapped ?? -1, passed: triggers?.mapped === 6 },
    { id: 'two-shield-overlays-preserved-as-approximations', expected: 2, actual: triggers?.approximated ?? -1, passed: triggers?.approximated === 2 },
    { id: 'unused-animation-running-definition-remains-unbound', expected: 1, actual: triggers?.unresolved ?? -1, passed: triggers?.unresolved === 1 && triggers?.triggers?.some((trigger) => trigger.clipId === 'animation.running' && trigger.status === 'unresolved') },
    { id: 'eight-source-used-clips-have-activation-paths', expected: 8, actual: wiring?.clipsActivated ?? -1, passed: Boolean(wiring && wiring.clipsActivated === 8 && wiring.controllerDrivenClips?.length === 8) },
    { id: 'base-and-overlay-player-controllers-are-separated', expected: '2 controller files; shield only in overlay', actual: `${controllerFiles.length} file(s), base=${baseControllerClips.length}, overlay=${overlayControllerClips.length}`, passed: controllerFiles.length === 2 && baseControllerClips.length === 6 && overlayControllerClips.length === 2 && overlayControllerClips.every((id) => id.includes('shield')) && !baseControllerClips.some((id) => id.includes('shield')) },
    { id: 'source movement state variables are reconstructed in player scope', expected: sourceMovementVariables.join(', '), actual: sourceMovementVariables.filter((name) => assignments.some((line) => line.startsWith(`variable.${name} =`))).join(', '), passed: sourceMovementVariables.every((name) => assignments.some((line) => line.startsWith(`variable.${name} =`))) && initialize.some((line) => line.startsWith('variable.spa_previous_body_yaw = 0.0')) },
    { id: 'all-nine-source-clip-definitions-emitted', expected: 'at least 9', actual: emittedClipIds.length, passed: emittedClipIds.length >= sourceClipIds.length },
    { id: 'no-duplicate-animation-identifiers', expected: 0, actual: duplicateDefinitions.length, passed: duplicateDefinitions.length === 0 },
    { id: 'vanilla-tcos0-variable-restored-from-source-baseline', expected: 'live Mojang movement expression', actual: tcos0 ?? 'missing', passed: Boolean(tcos0 && tcos0.includes('query.modified_distance_moved') && tcos0.includes('query.modified_move_speed')) },
    { id: 'spear-equipment-variable-uses-vanilla-item-tag', expected: "query.equipped_item_any_tag('slot.weapon.mainhand', 'minecraft:is_spear')", actual: spear ?? 'missing', passed: Boolean(spear && spear.includes("query.equipped_item_any_tag('slot.weapon.mainhand', 'minecraft:is_spear')")) },
    { id: 'no-invalid-armor-slot-hand-query-emitted', expected: 0, actual: invalidArmorQueries.length, passed: invalidArmorQueries.length === 0 },
    { id: 'vanilla-player-root-controller-wired', expected: 'root', actual: playerDescription?.scripts?.animate ?? [], passed: Array.isArray(playerDescription?.scripts?.animate) && playerDescription.scripts.animate.includes('root') },
  ];

  const report = {
    source: path.basename(sourcePath),
    archiveEntries: entries.filter((entry) => !entry.isDirectory).length,
    sourceClipIds,
    emittedClipIds,
    playerEntity: playerPath ?? null,
    playerWiring: wiring ?? null,
    triggerReport: triggers ?? null,
    playerAnimationPort: playerPort ?? null,
    playerDependencies,
    baselineGuard,
    duplicateDefinitions,
    invalidArmorQueries,
    assertions,
    passed: assertions.every((assertion) => assertion.passed),
    recentLogs: logs.slice(-80),
  };
  fs.writeFileSync(path.join(reportDir, 'pierced-current-engine.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ passed: report.passed, assertions, sourceClipIds, emittedClipCount: emittedClipIds.length, playerWiring: wiring, triggers: triggers ? { inspected: triggers.clipsInspected, unresolved: triggers.unresolved, mapped: triggers.mapped, scriptDriven: triggers.scriptDriven } : null }, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
} finally {
  await server.close();
}
