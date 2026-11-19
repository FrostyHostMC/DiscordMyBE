import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'Test Addons & Mods', 'Pierced Animations - Serious Player Animations - 1.20.x.zip');
const reportDir = path.resolve(root, '..', 'fixture-analysis');
fs.mkdirSync(reportDir, { recursive: true });
fs.copyFileSync(sourcePath, path.join(reportDir, 'Pierced-source-fixture.zip'));

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
  const { runRegressionSuite } = await server.ssrLoadModule('/src/utils/regressionSuite.ts');
  const { resolvePlayerDependencies } = await server.ssrLoadModule('/src/utils/playerDependencyResolver.ts');
  const { guaranteePlayerBaselineWiring } = await server.ssrLoadModule('/src/utils/playerBaselineGuard.ts');
  const { decompileAndInspectJarAsync } = await server.ssrLoadModule('/src/utils/javaDecompiler.ts');
  const { autoConfigureExperimentsForMod } = await server.ssrLoadModule('/src/utils/bedrockCapabilityQuery.ts');
  const { convertJavaToBedrockAddon } = await server.ssrLoadModule('/src/utils/bedrockGenerator.ts');
  const { translatePlayerTriggers } = await server.ssrLoadModule('/src/utils/playerAnimationTriggers.ts');
  const { translateJavaAnimationSet } = await server.ssrLoadModule('/src/utils/animationTranslator.ts');
  const { applyEntityAnimationEngine } = await server.ssrLoadModule('/src/utils/entityAnimationEngine.ts');
  const { bindMobParity } = await server.ssrLoadModule('/src/utils/mobParityBinder.ts');
  const { buildAnimationResourceRegistry } = await server.ssrLoadModule('/src/utils/animationResourceRegistry.ts');
  const { VANILLA_PLAYER_ANIMATIONS, VANILLA_PLAYER_RENDER_CONTROLLERS, VANILLA_PLAYER_RENDER_CONTROLLER_IDS, VANILLA_PLAYER_INITIALIZE, VANILLA_PLAYER_PRE_ANIMATION, VANILLA_PLAYER_VARIABLES } = await server.ssrLoadModule('/src/utils/vanillaPlayerBaseline.ts');
  const { VANILLA_PLAYER_GEOMETRY_JSON } = await server.ssrLoadModule('/src/utils/vanillaPlayerGeometry.ts');


  // The final generic entity pass must never reinterpret minecraft:player as a mob.
  // This late stage previously overwrote the player-specific animation rig.
  {
    const playerEntity = {
      format_version: '1.10.0',
      'minecraft:client_entity': { description: {
        identifier: 'minecraft:player',
        geometry: { default: 'geometry.humanoid.custom', cape: 'geometry.cape' },
        textures: { default: 'textures/entity/steve', cape: 'textures/entity/cape_invisible' },
        materials: { default: 'entity_alphatest', cape: 'entity_alphatest' },
        render_controllers: ['controller.render.player.first_person', 'controller.render.player.third_person', 'controller.render.fixture.player_generic']
      } }
    };
    const playerPack = {
      'entity/player.entity.json': JSON.stringify(playerEntity),
      'models/entity/player.geo.json': JSON.stringify({
        format_version: '1.12.0',
        'minecraft:geometry': [{ description: { identifier: 'geometry.fixture.player_mob_fallback' }, bones: [
          { name: 'root' }, { name: 'body', parent: 'root' }, { name: 'left_arm', parent: 'body' }
        ] }]
      }),
      'textures/entity/player.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      'render_controllers/player.render_controllers.json': JSON.stringify({ render_controllers: {
        'controller.render.fixture.player_generic': { geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }], textures: ['Texture.default'] }
      } })
    };
    const beforePlayer = JSON.parse(playerPack['entity/player.entity.json']);
    const entityPass = applyEntityAnimationEngine({
      modId: 'fixture',
      resourcePackFiles: playerPack,
      items: [],
      assetIndex: null
    });
    const parityLogs = [];
    const parityPass = bindMobParity({
      modId: 'fixture',
      resourcePackFiles: playerPack,
      behaviorPackFiles: {},
      onLog: (line) => parityLogs.push(line)
    });
    const baselineLogs = [];
    const baselineGuard = guaranteePlayerBaselineWiring({ resourcePackFiles: playerPack, onLog: (line) => baselineLogs.push(line) });
    const afterPlayer = JSON.parse(playerPack['entity/player.entity.json']);
    const beforeDescription = beforePlayer['minecraft:client_entity'].description;
    const afterDescription = afterPlayer['minecraft:client_entity'].description;
    assert.deepEqual(afterDescription.geometry, beforeDescription.geometry);
    assert.deepEqual(afterDescription.textures, beforeDescription.textures);
    assert.deepEqual(afterDescription.materials, beforeDescription.materials);
    assert.equal(entityPass.mobs, 0);
    assert.equal(entityPass.renderControllersGenerated, 0);
    assert.equal(parityPass.mobs, 0);
    assert.ok(parityLogs.some((line) => line.includes('Skipped engine-owned minecraft:player')));
    assert.deepEqual(JSON.parse(playerPack['entity/player.entity.json'])['minecraft:client_entity'].description.render_controllers, VANILLA_PLAYER_RENDER_CONTROLLERS);
    assert.ok(baselineGuard.renderControllersRestored > 0);
    assert.ok(baselineLogs.some((line) => line.includes('render-controller binding(s) restored')));
    assert.ok(entityPass.skipped.some((entry) => entry.includes('engine-owned minecraft:player rig preserved')));
  }


  // A fuzzy player-bone synonym is not a valid Bedrock runtime binding. The final
  // geometry's bone names must exactly match the exported animation track keys.
  {
    const animation = {
      format_version: '1.8.0',
      animations: {
        'animation.fixture.player_move': {
          animation_length: 0.4,
          bones: { leftArm: { rotation: { '0.0': [0, 0, 0], '0.4': [30, 0, 0] } } }
        }
      }
    };
    const customGeometryPack = {
      'entity/player.entity.json': JSON.stringify({
        'minecraft:client_entity': { description: {
          identifier: 'minecraft:player',
          geometry: { default: 'geometry.fixture.player' },
          animations: { move: 'animation.fixture.player_move' },
          scripts: { animate: ['move'] }
        } }
      }),
      'models/entity/player.geo.json': JSON.stringify({
        format_version: '1.12.0',
        'minecraft:geometry': [{
          description: { identifier: 'geometry.fixture.player' },
          bones: [{ name: 'root' }, { name: 'body', parent: 'root' }, { name: 'left_arm', parent: 'body' }]
        }]
      }),
      'animations/player.animation.json': JSON.stringify(animation)
    };
    const customRegistry = buildAnimationResourceRegistry({ resourcePackFiles: customGeometryPack });
    assert.ok(customRegistry.metrics.bones.unresolved.some((entry) => entry.includes('leftArm')),
      'a leftArm track must fail against custom geometry that only declares left_arm');

    const vanillaPlayerPack = {
      'entity/player.entity.json': JSON.stringify({
        'minecraft:client_entity': { description: {
          identifier: 'minecraft:player',
          geometry: { default: 'geometry.humanoid.custom' },
          animations: { move: 'animation.fixture.player_move' },
          scripts: { animate: ['move'] }
        } }
      }),
      'animations/player.animation.json': JSON.stringify(animation)
    };
    const vanillaRegistry = buildAnimationResourceRegistry({ resourcePackFiles: vanillaPlayerPack });
    assert.deepEqual(vanillaRegistry.metrics.bones.unresolved, [],
      'the exact canonical leftArm track must resolve against the engine-owned player skeleton');

    const renderControllerRegistry = buildAnimationResourceRegistry({
      resourcePackFiles: {
        'entity/player.entity.json': JSON.stringify({
          'minecraft:client_entity': { description: {
            identifier: 'minecraft:player',
            render_controllers: [
              { 'controller.render.player.first_person': 'query.is_first_person' },
              { 'controller.render.player.cape': '1.0' }
            ]
          } }
        })
      }
    });
    assert.ok(renderControllerRegistry.metrics.renderControllersEngineProvided.includes('controller.render.player.first_person'));
    assert.ok(renderControllerRegistry.metrics.renderControllersUnresolved.includes('controller.render.player.cape'),
      'the registry must not treat a nonexistent player cape controller as a vanilla engine resource');
  }

  setPlayableMode(false);
  const regressionSuiteReport = await runRegressionSuite({
    modId: 'fixture',
    playableMode: false,
    onLog: (line) => process.stdout.write(line + '\n'),
  });
  const regressionSuiteDiagnostics = {
    total: regressionSuiteReport.total,
    passed: regressionSuiteReport.passed,
    partial: regressionSuiteReport.partial,
    failed: regressionSuiteReport.failed,
    summary: regressionSuiteReport.summary,
    reviewedFixtures: regressionSuiteReport.fixtures
      .filter((fixture) => fixture.status !== 'passed')
      .map((fixture) => ({
        id: fixture.id,
        label: fixture.label,
        category: fixture.category,
        status: fixture.status,
        findings: fixture.findings,
        failedAssertions: fixture.assertions.filter((assertion) => !assertion.passed),
        unavailable: fixture.unavailable,
      })),
  };
  process.stdout.write('[REGRESSION:DIAGNOSTICS] ' + JSON.stringify(regressionSuiteDiagnostics) + '\\n');
  const archiveBytes = new Uint8Array(fs.readFileSync(sourcePath));
  const entries = await readZipArchive(archiveBytes, {
    maxEntries: 5000,
    maxEntryBytes: 128 * 1024 * 1024,
    maxTotalBytes: 256 * 1024 * 1024,
  });
  const sourceFilePath = process.env.SERIOUS_PLAYER_ANIMATIONS_SOURCE;
  if (!sourceFilePath || !fs.existsSync(sourceFilePath)) {
    throw new Error('The pinned Serious Player Animations 1.1.1 Java source file is required for the source-trigger regression.');
  }
  const encoder = new TextEncoder();
  const sourceCode = encoder.encode(fs.readFileSync(sourceFilePath, 'utf8'));
  const metadata = encoder.encode(JSON.stringify({ id: 'seriousplayeranimations', version: '1.1.0' }));
  const sourceEvidenceEntries = [
    { path: 'fabric.mod.json', data: metadata, isDirectory: false, uncompressedSize: metadata.byteLength },
    {
      path: 'net/mcvader/seriousplayeranimations/mixin/SeriousPlayerAnimationsMixin.java',
      data: sourceCode,
      isDirectory: false,
      uncompressedSize: sourceCode.byteLength,
    },
  ];
  const archiveEntries = [...entries, ...sourceEvidenceEntries];

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

  const syntheticClip = { bones: { rightArm: { rotation: { '0': [0, 0, 0], '0.4': [45, 0, 0] } } }, loop: false, animation_length: 0.4 };
  const unrelatedClass = new TextEncoder().encode('net/example/Unrelated.class isSprinting');
  const registeredClass = new TextEncoder().encode('net/example/WalkingAnimation.class walking isMoving');
  const unrelatedTrigger = translatePlayerTriggers({
    clips: { 'animation.walking': syntheticClip },
    archiveEntries: [{ path: 'net/example/Unrelated.class', data: unrelatedClass }],
    sourceClipIdsByClipId: { 'animation.walking': 'walking' },
  }).triggers[0];
  const registeredTrigger = translatePlayerTriggers({
    clips: { 'animation.walking': syntheticClip },
    archiveEntries: [{ path: 'net/example/WalkingAnimation.class', data: registeredClass }],
    sourceClipIdsByClipId: { 'animation.walking': 'walking' },
  }).triggers[0];

  const eventTranslation = translateJavaAnimationSet({
    animations: {
      'animation.event_fixture': {
        bones: { rightArm: { rotation: { '0': [0, 0, 0], '0.4': [20, 0, 0] } } },
        sound_effects: { '0.2': { effect: 'test:swing', locator: 'right_hand', custom_payload: true } },
        particle_effects: { '0.3': { effect: 'test:spark', locator: 'right_hand' } },
      },
    },
  });
  const eventClip = eventTranslation.animations['animation.event_fixture'];
  const eventMetadataPreserved = eventClip?.sound_effects?.['0.2']?.locator === 'right_hand'
    && eventClip?.particle_effects?.['0.3']?.locator === 'right_hand';
  const eventLossReported = eventTranslation.issues.some((issue) => issue.channel === 'sound_effects' && issue.detail.includes('custom_payload'));

  const expectedPlayerClipIds = sourceClipIds;
  const logs = [];
  const result = portMobAndPlayerAnimations(
    'pierced_fixture',
    'Pierced Animations fixture',
    [],
    archiveEntries,
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
    sourceProfiles: result.playerTriggerReport?.sourceProfile ? [result.playerTriggerReport.sourceProfile] : [],
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
  const sourceMovementVariables = ['spa_move_speed', 'spa_turn_delta', 'spa_previous_body_yaw'];
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
  const invalidPlayerPositionQueries = Object.entries(result.resourcePackFiles)
    .filter(([file]) => /player\.entity\.json$/i.test(file))
    .filter(([, raw]) => typeof raw === 'string')
    .flatMap(([file, raw]) => [...raw.matchAll(/query\.position\s*\(/g)].map((match) => ({ file, call: match[0] })));
  const invalidArmorQueries = Object.entries(result.resourcePackFiles)
    .filter(([, raw]) => typeof raw === 'string')
    .flatMap(([file, raw]) => [...raw.matchAll(/query\.get_equipped_item_name\(\s*['"]slot\.armor[^)]*\)/gi)].map((match) => ({ file, call: match[0] })));

  const wiring = result.playerEntityWiring;
  const triggers = result.playerTriggerReport;
  const playerPort = result.playerAnimationPort ?? null;
  const unresolvedTrigger = triggers?.triggers.find((trigger) => trigger.sourceClipId === 'animation.running');
  const javaRunningTrigger = triggers?.triggers.find((trigger) => trigger.sourceClipId === 'running');
  const sourceRunningDefinition = Object.values(result.playerSourceClipIdByPlayerClipId ?? {}).includes('animation.running');
  const assertions = [
    { id: 'animation-sound-and-particle-event-locators-preserved', expected: true, actual: eventMetadataPreserved, passed: eventMetadataPreserved },
    { id: 'unsupported-animation-event-fields-reported-not-silently-dropped', expected: true, actual: eventLossReported, passed: eventLossReported },
    { id: 'unrelated-java-api-hit-does-not-activate-a-clip', expected: 'unresolved', actual: unrelatedTrigger?.status ?? 'missing', passed: unrelatedTrigger?.status === 'unresolved' && !unrelatedTrigger.condition },
    { id: 'same-class-clip-registration-and-java-state-correlate', expected: 'mapped', actual: registeredTrigger?.status ?? 'missing', passed: registeredTrigger?.status === 'mapped' && Boolean(registeredTrigger.condition) },
    { id: 'source-fixture-has-nine-animation-definitions', expected: 9, actual: sourceClipIds.length, passed: sourceClipIds.length === 9 },
    { id: 'player-trigger-bridge-inspected-every-source-clip', expected: sourceClipIds.length, actual: triggers?.clipsInspected ?? 0, passed: Boolean(triggers && triggers.clipsInspected === sourceClipIds.length) },
    { id: 'all-java-loaded-clips-registered-on-player', expected: expectedPlayerClipIds.length, actual: wiring?.clipsRegistered ?? 0, passed: Boolean(wiring && wiring.clipsRegistered === expectedPlayerClipIds.length) },
    { id: 'verified-serious-player-animations-source-profile-recognized', expected: 'Serious Player Animations 1.1.1', actual: triggers?.sourceProfile ?? 'missing', passed: triggers?.sourceProfile === 'Serious Player Animations 1.1.1' },
    { id: 'five-safe-source-locomotion-clips-mapped-and-backward-explicitly-withheld', expected: 5, actual: triggers?.mapped ?? -1, passed: triggers?.mapped === 5 && triggers?.triggers?.some((trigger) => trigger.sourceClipId === 'walking_backwards' && trigger.status === 'unresolved' && !trigger.condition) },
    { id: 'two-shield-overlays-preserved-as-approximations', expected: 2, actual: triggers?.approximated ?? -1, passed: triggers?.approximated === 2 },
    { id: 'unused-animation.running-source-definition-remains-unbound', expected: 'source animation.running unresolved', actual: unresolvedTrigger?.status ?? 'missing', passed: sourceRunningDefinition && unresolvedTrigger?.status === 'unresolved' && Boolean(wiring?.unresolvedClips?.includes(unresolvedTrigger.clipId)) },
    { id: 'java-running-resource-key-activates-the-correct-source-clip', expected: 'source key running mapped and controller-driven', actual: javaRunningTrigger?.clipId ?? 'missing', passed: javaRunningTrigger?.status === 'mapped' && Boolean(wiring?.controllerDrivenClips?.includes(javaRunningTrigger.clipId)) },
    { id: 'seven-safe-source-used-clips-have-activation-paths', expected: 7, actual: wiring?.clipsActivated ?? -1, passed: Boolean(wiring && wiring.clipsActivated === 7 && wiring.controllerDrivenClips?.length === 7) },
    { id: 'unresolved-backward-clip-is-never-added-to-perspective-only-animate-fallback', expected: false, actual: Boolean(wiring?.unconditionalClips?.includes('animation.player.player.walking_backwards')), passed: !wiring?.unconditionalClips?.includes('animation.player.player.walking_backwards') && !playerDescription?.scripts?.animate?.some((entry) => typeof entry === 'object' && Object.keys(entry).some((key) => key.includes('walking_backwards'))) },
    { id: 'base-and-overlay-player-controllers-are-separated', expected: '2 controller files; shield only in overlay', actual: `${controllerFiles.length} file(s), base=${baseControllerClips.length}, overlay=${overlayControllerClips.length}`, passed: controllerFiles.length === 2 && baseControllerClips.length === 5 && overlayControllerClips.length === 2 && overlayControllerClips.every((id) => id.includes('shield')) && !baseControllerClips.some((id) => id.includes('shield')) },
    { id: 'source movement state variables are reconstructed in player scope', expected: sourceMovementVariables.join(', '), actual: sourceMovementVariables.filter((name) => assignments.some((line) => line.startsWith(`variable.${name} =`))).join(', '), passed: sourceMovementVariables.every((name) => assignments.some((line) => line.startsWith(`variable.${name} =`))) && ['spa_previous_body_yaw'].every((name) => initialize.some((line) => line.startsWith('variable.' + name + ' = 0.0'))) },
    { id: 'all-nine-source-clip-definitions-emitted', expected: 'at least 9', actual: emittedClipIds.length, passed: emittedClipIds.length >= sourceClipIds.length },
    { id: 'no-duplicate-animation-identifiers', expected: 0, actual: duplicateDefinitions.length, passed: duplicateDefinitions.length === 0 },
    { id: 'vanilla-tcos0-variable-restored-from-source-baseline', expected: 'live Mojang movement expression', actual: tcos0 ?? 'missing', passed: Boolean(tcos0 && tcos0.includes('query.modified_distance_moved') && tcos0.includes('query.modified_move_speed')) },
    { id: 'spear-equipment-variable-uses-vanilla-item-tag', expected: "query.equipped_item_any_tag('slot.weapon.mainhand', 'minecraft:is_spear')", actual: spear ?? 'missing', passed: Boolean(spear && spear.includes("query.equipped_item_any_tag('slot.weapon.mainhand', 'minecraft:is_spear')")) },
    { id: 'no-invalid-armor-slot-hand-query-emitted', expected: 0, actual: invalidArmorQueries.length, passed: invalidArmorQueries.length === 0 },
    { id: 'player-animation-scope-uses-position-delta-not-absolute-position-query', expected: 0, actual: invalidPlayerPositionQueries.length, passed: invalidPlayerPositionQueries.length === 0 },
    { id: 'vanilla-player-root-controller-wired', expected: 'root', actual: playerDescription?.scripts?.animate ?? [], passed: Array.isArray(playerDescription?.scripts?.animate) && playerDescription.scripts.animate.includes('root') },
    { id: 'player-variable-dependency-audit-has-no-unresolved-variables', expected: 0, actual: playerDependencies?.variables?.unresolved?.length ?? -1, passed: Boolean(playerDependencies && playerDependencies.variables.unresolved.length === 0) },
    { id: 'player-static-dependency-validation-passes', expected: true, actual: playerDependencies?.staticValidationPassed ?? false, passed: playerDependencies?.staticValidationPassed === true },
  ];

  const report = {
    source: path.basename(sourcePath),
    archiveEntries: archiveEntries.filter((entry) => !entry.isDirectory).length,
    sourceEvidence: 'McVader34/Serious-Player-Animations@2dc73ceb744a4fb861437b51f1fe6c95ca4ac902',
    sourceClipIds,
    playerSourceClipIds: result.playerSourceClipIds ?? [],
    playerSourceClipIdByPlayerClipId: result.playerSourceClipIdByPlayerClipId ?? {},
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
    regressionSuiteDiagnostics,
    passed: assertions.every((assertion) => assertion.passed),
    recentLogs: logs.slice(-80),
  };
  if (report.passed) {
    const fullLogs = [];
    const brief = 'Port Serious Player Animations 1.1.1 to Bedrock. Preserve the supplied player animation definitions and Java-derived playback conditions. Do not invent triggers for unused clips.';
    const fileName = 'seriousplayeranimations-1.1.1.jar';
    const inspection = await decompileAndInspectJarAsync(archiveEntries, fileName, {
      onProgress: (done, total) => {
        if (total > 0) fullLogs.push(`Java source inspection: ${done}/${total} classes`);
      },
    });
    const automatic = autoConfigureExperimentsForMod(brief, archiveEntries, '1.26.63');
    const fullResult = await convertJavaToBedrockAddon({
      brief,
      fileName,
      entries: archiveEntries,
      decompileData: inspection,
      enableUpscaling: false,
      targetVersion: automatic.targetVersion,
      experimentConfig: automatic.config,
      enableGeyser: false,
      geyserVersion: '2.6.0',
      onLog: (line) => {
        fullLogs.push(line);
        if (fullLogs.length > 300) fullLogs.shift();
      },
      onAutoRepairTrigger: () => fullLogs.push('Automatic repair requested by the converter'),
    });
    if (!fullResult.zipBytes || fullResult.zipBytes.byteLength === 0) {
      throw new Error('The full JavaBE converter returned an empty .mcaddon archive.');
    }
    const addonBytes = fullResult.zipBytes instanceof Uint8Array
      ? fullResult.zipBytes
      : new Uint8Array(fullResult.zipBytes);
    const addonPath = path.join(reportDir, 'SeriousPlayerAnimations-1.1.1.mcaddon');
    fs.writeFileSync(addonPath, Buffer.from(addonBytes));
    const bundleEntries = await readZipArchive(addonBytes, {
      maxEntries: 5000,
      maxEntryBytes: 128 * 1024 * 1024,
      maxTotalBytes: 256 * 1024 * 1024,
    });
    const mcpackEntries = bundleEntries.filter((entry) => !entry.isDirectory && /\.mcpack$/i.test(entry.path));
    const resourcePackEntry = mcpackEntries.find((entry) => /resource/i.test(entry.path));
    const resourcePackBytes = resourcePackEntry?.data instanceof Uint8Array
      ? resourcePackEntry.data
      : resourcePackEntry?.data
        ? new Uint8Array(resourcePackEntry.data)
        : null;
    const resourcePackEntries = resourcePackBytes
      ? await readZipArchive(resourcePackBytes, {
          maxEntries: 5000,
          maxEntryBytes: 128 * 1024 * 1024,
          maxTotalBytes: 256 * 1024 * 1024,
        })
      : [];
    const archiveResourceText = new Map(resourcePackEntries
      .filter((entry) => !entry.isDirectory)
      .map((entry) => [entry.path.toLowerCase(), new TextDecoder().decode(entry.data)]));
    const readArchiveJson = (pathName) => {
      const raw = archiveResourceText.get(pathName.toLowerCase());
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    };
    const archivePlayerDescription = readArchiveJson('entity/player.entity.json')?.['minecraft:client_entity']?.description ?? null;
    const archivePlayerGeometryMap = typeof archivePlayerDescription?.geometry === 'string'
      ? { default: archivePlayerDescription.geometry }
      : archivePlayerDescription?.geometry ?? {};
    const archivePlayerDefaultGeometry = archivePlayerGeometryMap.default ?? '';
    const vanillaPlayerGeometries = JSON.parse(VANILLA_PLAYER_GEOMETRY_JSON)['minecraft:geometry'];
    const vanillaPlayerGeometry = vanillaPlayerGeometries.find((geometry) =>
      geometry.description?.identifier === archivePlayerDefaultGeometry);
    const shippedGeometryDocuments = resourcePackEntries
      .filter((entry) => !entry.isDirectory && entry.path.toLowerCase().startsWith('models/') && entry.path.toLowerCase().endsWith('.json'))
      .map((entry) => {
        try { return JSON.parse(new TextDecoder().decode(entry.data)); } catch { return null; }
      })
      .filter(Boolean)
      .flatMap((document) => document['minecraft:geometry'] ?? []);
    const shippedPlayerGeometry = shippedGeometryDocuments.find((geometry) =>
      geometry.description?.identifier === archivePlayerDefaultGeometry);
    const effectivePlayerGeometry = shippedPlayerGeometry ?? vanillaPlayerGeometry;
    const archivePlayerBones = new Set((effectivePlayerGeometry?.bones ?? []).map((bone) => bone.name));
    const registeredPlayerClipIds = new Set(Object.values(archivePlayerDescription?.animations ?? {})
      .filter((value) => typeof value === 'string' && value.startsWith('animation.')));
    const archivePlayerClipBones = new Set();
    const archivePlayerClipOverrides = [];
    for (const entry of resourcePackEntries) {
      const lowerPath = entry.path.toLowerCase();
      if (entry.isDirectory || !lowerPath.startsWith('animations/') || !lowerPath.endsWith('.animation.json')) continue;
      let document;
      try { document = JSON.parse(new TextDecoder().decode(entry.data)); } catch { continue; }
      for (const [clipId, clip] of Object.entries(document?.animations ?? {})) {
        if (!registeredPlayerClipIds.has(clipId)) continue;
        for (const boneName of Object.keys(clip?.bones ?? {})) archivePlayerClipBones.add(boneName);
        archivePlayerClipOverrides.push({ clipId, override: clip?.override_previous_animation === true });
      }
    }
    const unresolvedArchivePlayerBones = [...archivePlayerClipBones].filter((bone) => !archivePlayerBones.has(bone));
    const genericPlayerFallbackPresent = archiveResourceText.has('models/entity/player.geo.json');
    const playerFallbackAssignments = [
      'is_holding_left', 'is_brandishing_spear', 'damage_nearby_mobs', 'swim_amount', 'use_item_interval_progress',
    ];
    const finalPreAnimation = Array.isArray(archivePlayerDescription?.scripts?.pre_animation)
      ? archivePlayerDescription.scripts.pre_animation
      : [];
    const missingPlayerFallbackAssignments = playerFallbackAssignments.filter((name) =>
      !finalPreAnimation.some((statement) => typeof statement === 'string' && statement.startsWith(`variable.${name} =`)),
    );
    const archivePlayerGeometryAudit = {
      entityFound: Boolean(archivePlayerDescription),
      defaultGeometry: archivePlayerDefaultGeometry,
      capeGeometry: archivePlayerGeometryMap.cape ?? null,
      geometryResolves: Boolean(effectivePlayerGeometry),
      geometryBoneCount: archivePlayerBones.size,
      registeredClipBoneCount: archivePlayerClipBones.size,
      unresolvedAnimationBones: unresolvedArchivePlayerBones,
      genericPlayerFallbackPresent,
      skinTexture: archivePlayerDescription?.textures?.default ?? null,
      capeTexture: archivePlayerDescription?.textures?.cape ?? null,
      passed: Boolean(archivePlayerDescription)
        && Boolean(effectivePlayerGeometry)
        && archivePlayerDefaultGeometry === 'geometry.humanoid.custom'
        && archivePlayerGeometryMap.cape === 'geometry.cape'
        && unresolvedArchivePlayerBones.length === 0
        && !genericPlayerFallbackPresent
        && archivePlayerDescription?.textures?.default === 'textures/entity/steve'
        && archivePlayerDescription?.textures?.cape === 'textures/entity/cape_invisible',
    };
    const finalPlayerRaw = fullResult.resourcePackFiles?.['entity/player.entity.json'];
    const finalPlayerDescription = typeof finalPlayerRaw === 'string'
      ? JSON.parse(finalPlayerRaw)?.['minecraft:client_entity']?.description
      : null;
    const finalPlayerRenderControllerIds = (finalPlayerDescription?.render_controllers ?? []).flatMap((entry) =>
      typeof entry === 'string' ? [entry] : entry && typeof entry === 'object' ? Object.keys(entry) : [],
    );
    const missingVanillaPlayerAliases = Object.entries(VANILLA_PLAYER_ANIMATIONS)
      .filter(([alias, identifier]) => finalPlayerDescription?.animations?.[alias] !== identifier)
      .map(([alias]) => alias);
    const missingVanillaPlayerRenderControllers = [...VANILLA_PLAYER_RENDER_CONTROLLER_IDS]
      .filter((id) => !finalPlayerRenderControllerIds.includes(id));
    const resourceManifest = fullResult.resourcePackFiles?.['manifest.json'];
    const behaviorManifest = fullResult.behaviorPackFiles?.['manifest.json'];
    const unresolvedPlayerVariables = fullResult.playerDependencyResolution?.variables?.unresolved ?? [];
    const playerDependencyClean = fullResult.playerDependencyResolution?.staticValidationPassed === true
      && (fullResult.playerDependencyResolution?.blocking?.length ?? 0) === 0
      && fullResult.playerDependencyResolution?.firstPerson?.ready === true;
    const deliberatelyInactive = fullResult.animationIntegration?.metrics?.deliberatelyInactiveClips ?? [];
    const fullAssertions = [
      { id: 'full-converter-emits-nonempty-mcaddon', expected: 'non-empty .mcaddon', actual: addonBytes.byteLength, passed: addonBytes.byteLength > 0 },
      { id: 'full-converter-emits-resource-pack-manifest', expected: true, actual: Boolean(resourceManifest), passed: Boolean(resourceManifest) },
      { id: 'full-converter-emits-behavior-pack-manifest', expected: true, actual: Boolean(behaviorManifest), passed: Boolean(behaviorManifest) },
      { id: 'full-converter-preserves-serious-player-source-profile', expected: 'Serious Player Animations 1.1.1', actual: fullResult.playerTriggers?.sourceProfile ?? 'missing', passed: fullResult.playerTriggers?.sourceProfile === 'Serious Player Animations 1.1.1' },
      { id: 'full-converter-registers-all-nine-supplied-player-clips', expected: 9, actual: fullResult.playerEntityWiring?.clipsRegistered ?? -1, passed: fullResult.playerEntityWiring?.clipsRegistered === 9 },
      { id: 'full-converter-activates-seven-safe-java-used-player-clips', expected: 7, actual: fullResult.playerEntityWiring?.clipsActivated ?? -1, passed: fullResult.playerEntityWiring?.clipsActivated === 7 },
      { id: 'full-converter-classifies-unused-and-unsupported-trigger-clips-as-intentionally-inactive', expected: 2, actual: deliberatelyInactive, passed: deliberatelyInactive.length === 2 && deliberatelyInactive.some((id) => id.includes('running')) && deliberatelyInactive.some((id) => id.includes('walking_backwards')) },
      { id: 'full-converter-player-variable-audit-is-clean', expected: 0, actual: unresolvedPlayerVariables.length, passed: unresolvedPlayerVariables.length === 0 },
      { id: 'full-converter-reconstructs-player-controller-variables-missing-on-older-runtime', expected: 0, actual: missingPlayerFallbackAssignments.length, passed: missingPlayerFallbackAssignments.length === 0 },
      { id: 'full-converter-player-animations-reset-vanilla-bone-poses-before-playing', expected: 'all registered player clips override previous animation', actual: archivePlayerClipOverrides.filter((entry) => !entry.override).map((entry) => entry.clipId), passed: archivePlayerClipOverrides.length > 0 && archivePlayerClipOverrides.every((entry) => entry.override) },
      { id: 'full-converter-player-baseline-and-first-person-contract-pass', expected: true, actual: playerDependencyClean, passed: playerDependencyClean },
      { id: 'full-converter-animation-integration-audit-passes', expected: true, actual: fullResult.animationIntegration?.passed ?? false, passed: fullResult.animationIntegration?.passed === true },
      { id: 'full-converter-fidelity-matches-all-nine-source-definitions', expected: { shipped: 9, missing: 0 }, actual: { shipped: fullResult.animationFidelity?.clipsShipped ?? -1, missing: fullResult.animationFidelity?.clipsMissing ?? -1 }, passed: fullResult.animationFidelity?.clipsShipped === 9 && fullResult.animationFidelity?.clipsMissing === 0 },
      { id: 'full-converter-runtime-structure-audit-passes', expected: true, actual: fullResult.animationRuntime?.passed ?? false, passed: fullResult.animationRuntime?.passed === true },
      { id: 'full-converter-retains-every-active-source-bone-track-and-excludes-unused-definition-controls', expected: { active: 46, retained: 46, inactive: 81, coverage: 100 }, actual: { active: fullResult.animationFidelity?.sourceBoneTracksActive ?? -1, retained: fullResult.animationFidelity?.sourceBoneTracksRetained ?? -1, inactive: fullResult.animationFidelity?.sourceBoneTracksInactive ?? -1, coverage: fullResult.animationFidelity?.boneTrackCoverage ?? -1 }, passed: fullResult.animationFidelity?.sourceBoneTracksActive === 46 && fullResult.animationFidelity?.sourceBoneTracksRetained === 46 && fullResult.animationFidelity?.sourceBoneTracksInactive === 81 && fullResult.animationFidelity?.boneTrackCoverage === 100 },
      { id: 'full-converter-player-pre-animation-contains-no-standalone-conditional-block-braces', expected: 0, actual: (finalPlayerDescription?.scripts?.pre_animation ?? []).filter((statement) => /^\\s*[{};]+\\s*$/.test(statement)).length, passed: !(finalPlayerDescription?.scripts?.pre_animation ?? []).some((statement) => /^\\s*[{};]+\\s*$/.test(statement)) },
      { id: 'full-converter-player-pre-animation-has-no-unbalanced-braces', expected: 0, actual: (finalPlayerDescription?.scripts?.pre_animation ?? []).filter((statement) => (statement.match(/{/g) ?? []).length !== (statement.match(/}/g) ?? []).length).length, passed: (finalPlayerDescription?.scripts?.pre_animation ?? []).every((statement) => (statement.match(/{/g) ?? []).length === (statement.match(/}/g) ?? []).length) },
      { id: 'full-converter-does-not-activate-missing-legacy-base-controller', expected: false, actual: (finalPlayerDescription?.scripts?.animate ?? []).includes('base_controller'), passed: !(finalPlayerDescription?.scripts?.animate ?? []).includes('base_controller') },
      { id: 'full-converter-player-molang-has-no-unsupported-query-references', expected: 0, actual: fullResult.animationRuntime?.molang?.unresolved?.length ?? -1, passed: fullResult.animationRuntime?.molang?.unresolved?.length === 0 },
      { id: 'full-converter-player-keeps-vanilla-geometry-after-final-entity-binding', expected: 'geometry.humanoid.custom', actual: finalPlayerDescription?.geometry?.default ?? 'missing', passed: finalPlayerDescription?.geometry?.default === 'geometry.humanoid.custom' },
      { id: 'full-converter-player-cape-keeps-vanilla-cape-geometry', expected: 'geometry.cape', actual: finalPlayerDescription?.geometry?.cape ?? 'missing', passed: finalPlayerDescription?.geometry?.cape === 'geometry.cape' },
      { id: 'full-converter-preserves-all-mojang-player-animation-aliases', expected: Object.keys(VANILLA_PLAYER_ANIMATIONS).length, actual: missingVanillaPlayerAliases.length, passed: missingVanillaPlayerAliases.length === 0 },
      { id: 'full-converter-preserves-all-five-conditional-vanilla-player-render-controllers', expected: 5, actual: finalPlayerRenderControllerIds.filter((id) => VANILLA_PLAYER_RENDER_CONTROLLER_IDS.has(id)).length, passed: missingVanillaPlayerRenderControllers.length === 0 },
      { id: 'full-converter-does-not-invent-a-cape-render-controller', expected: false, actual: finalPlayerRenderControllerIds.includes('controller.render.player.cape'), passed: !finalPlayerRenderControllerIds.includes('controller.render.player.cape') },
      { id: 'full-converter-preserves-vanilla-player-material-layers-and-attachables', expected: 'animated + spectator materials; attachables enabled', actual: `${String(finalPlayerDescription?.materials?.animated ?? 'missing')} / ${String(finalPlayerDescription?.materials?.spectator ?? 'missing')} / ${String(finalPlayerDescription?.enable_attachables)}`, passed: finalPlayerDescription?.materials?.animated === 'player_animated' && finalPlayerDescription?.materials?.spectator === 'player_spectator' && finalPlayerDescription?.enable_attachables === true },
      { id: 'full-converter-preserves-complete-mojang-player-initialize-and-pre-animation-baseline', expected: { initialize: VANILLA_PLAYER_INITIALIZE.length, preAnimation: VANILLA_PLAYER_PRE_ANIMATION.length }, actual: { initialize: finalPlayerDescription?.scripts?.initialize?.length ?? 0, preAnimation: finalPlayerDescription?.scripts?.pre_animation?.length ?? 0 }, passed: VANILLA_PLAYER_INITIALIZE.every((statement) => (finalPlayerDescription?.scripts?.initialize ?? []).includes(statement)) && VANILLA_PLAYER_PRE_ANIMATION.every((statement) => (finalPlayerDescription?.scripts?.pre_animation ?? []).includes(statement)) },
      { id: 'full-converter-declares-public-vanilla-player-variables', expected: Object.keys(VANILLA_PLAYER_VARIABLES).length, actual: Object.keys(finalPlayerDescription?.scripts?.variables ?? {}).length, passed: Object.entries(VANILLA_PLAYER_VARIABLES).every(([name, scope]) => finalPlayerDescription?.scripts?.variables?.[name] === scope) },
      { id: 'full-converter-restores-spear-arm-rotation-variable-expressions', expected: ['tp_melee_spear_base_arm_rotation_x', 'tp_melee_spear_use_arm_rotation_x', 'tp_melee_spear_use_arm_rotation_y', 'tp_melee_spear_use_arm_rotation_z', 'tp_melee_spear_use_item_rotation_x'], actual: VANILLA_PLAYER_PRE_ANIMATION.filter((statement) => /tp_melee_spear_(?:base_arm_rotation_x|use_arm_rotation_[xyz]|use_item_rotation_x)/.test(statement)).length, passed: ['tp_melee_spear_base_arm_rotation_x', 'tp_melee_spear_use_arm_rotation_x', 'tp_melee_spear_use_arm_rotation_y', 'tp_melee_spear_use_arm_rotation_z', 'tp_melee_spear_use_item_rotation_x'].every((name) => VANILLA_PLAYER_PRE_ANIMATION.some((statement) => statement.includes(name))) },
      { id: 'full-converter-does-not-bind-player-to-generic-mob-render-controller', expected: false, actual: finalPlayerRenderControllerIds.some((id) => id.includes('seriousplayeranimations_1_1_1.player')), passed: !finalPlayerRenderControllerIds.some((id) => id.includes('seriousplayeranimations_1_1_1.player')) },
      { id: 'full-converter-produces-pack-archives', expected: 'at least one .mcpack', actual: mcpackEntries.map((entry) => entry.path), passed: mcpackEntries.length >= 1 },
      { id: 'full-converter-final-mcpack-preserves-real-player-skeleton-and-all-player-bone-bindings', expected: 'Mojang humanoid.custom bone names; no generic player mob model', actual: archivePlayerGeometryAudit, passed: archivePlayerGeometryAudit.passed },
    ];
    report.fullConversion = {
      passed: fullAssertions.every((assertion) => assertion.passed),
      addonPath: path.basename(addonPath),
      addonBytes: addonBytes.byteLength,
      outputFileName: fullResult.fileName,
      targetVersion: automatic.targetVersion,
      sourceInspection: {
        classes: inspection.stats?.classes?.length ?? 0,
        jvmClasses: inspection.jvm?.totals?.classes ?? inspection.jvm?.totals?.classFiles ?? 0,
      },
      resourcePackFileCount: Object.keys(fullResult.resourcePackFiles ?? {}).length,
      behaviorPackFileCount: Object.keys(fullResult.behaviorPackFiles ?? {}).length,
      mcpackEntries: mcpackEntries.map((entry) => entry.path),
      archivePlayerGeometryAudit,
      archivePlayerClipOverrides,
      missingPlayerFallbackAssignments,
      playerWiring: fullResult.playerEntityWiring ?? null,
      playerTriggers: fullResult.playerTriggers ?? null,
      playerAnimationPort: fullResult.playerAnimationPort ?? null,
      playerDependencyResolution: fullResult.playerDependencyResolution ?? null,
      playerBaselineGuard: fullResult.playerBaselineGuard ?? null,
      animationIntegration: fullResult.animationIntegration ?? null,
      animationFidelity: fullResult.animationFidelity ?? null,
      animationRuntime: fullResult.animationRuntime ?? null,
      assertions: fullAssertions,
      recentLogs: fullLogs.slice(-100),
    };
    if (!report.fullConversion.passed) process.exitCode = 1;
  }
  fs.writeFileSync(path.join(reportDir, 'pierced-current-engine.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ passed: report.passed, regressionSuiteDiagnostics, assertions, sourceClipIds, emittedClipCount: emittedClipIds.length, playerWiring: wiring, triggers: triggers ? { inspected: triggers.clipsInspected, unresolved: triggers.unresolved, mapped: triggers.mapped, scriptDriven: triggers.scriptDriven } : null }, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
} finally {
  await server.close();
}
