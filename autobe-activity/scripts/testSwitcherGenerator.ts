import assert from 'node:assert/strict';
import { buildSwitcherArtifacts } from '../src/utils/switcherGenerator.ts';

const artifacts = buildSwitcherArtifacts({
  entityIdentifier: 'minecraft:player',
  itemIdentifier: 'autobe:animation_switcher',
  controllerIdentifier: 'autobe:player_animation_gatekeeper',
  propertyIdentifier: 'autobe:animation_mode',
  scriptEntry: 'scripts/Stonebyte.js',
  controllers: [
    {
      id: 'controller.test:walk',
      scope: 'player',
      initialState: 'default',
      states: {
        default: { animations: ['animation.test:walk'], transitions: [{ 'query.is_sprinting': 'sprint' }] },
        sprint: { animations: ['animation.test:sprint'], transitions: [{ 'query.is_sprinting == false': 'default' }] },
      },
    },
    {
      id: 'controller.test:wave',
      scope: 'player',
      initialState: 'main',
      states: {
        main: { animations: ['animation.test:wave'], transitions: [{ 'query.is_growing': 'main' }] },
      },
    },
  ],
});

assert.deepEqual(artifacts.validationErrors, []);
assert.equal(artifacts.itemId, 'autobe:animation_switcher');
assert.equal(artifacts.propertyId, 'autobe:animation_mode');
const controllerFile = artifacts.gatekeeperController as any;
const generated = controllerFile.animation_controllers[artifacts.controllerId];
assert.equal(generated.initial_state, 'autobe_selector');
assert.ok(generated.states.autobe_selector.transitions.some((transition: Record<string, string>) =>
  transition["query.property('autobe:animation_mode') == 0"] === artifacts.stateMap['controller.test:walk'].default));
assert.ok(generated.states.autobe_selector.transitions.some((transition: Record<string, string>) =>
  transition["query.property('autobe:animation_mode') == 1"] === artifacts.stateMap['controller.test:wave'].main));
assert.ok(generated.states[artifacts.stateMap['controller.test:walk'].default].transitions[0]
  ["query.property('autobe:animation_mode') == 1"]);
assert.match(artifacts.scriptSource, /world\.afterEvents\.itemUse\.subscribe/);
assert.match(artifacts.scriptSource, /player\.setProperty\(PROPERTY_ID, \(current \+ 1\) % MODE_COUNT\)/);
assert.equal(artifacts.stateMap['controller.test:walk'].default, 'autobe_0_controller_test_walk_default');

const invalid = buildSwitcherArtifacts({
  entityIdentifier: 'minecraft:player',
  itemIdentifier: 'autobe:animation_switcher',
  controllerIdentifier: 'autobe:player_animation_gatekeeper',
  propertyIdentifier: 'autobe:animation_mode',
  scriptEntry: 'scripts/Stonebyte.js',
  controllers: [{
    id: 'controller.test:bad',
    scope: 'player',
    initialState: 'missing',
    states: { default: { transitions: [{ 'query.foo': 'missing' }] } },
  }],
});
assert.ok(invalid.validationErrors.length >= 2);
console.log('Switcher generator synthetic tests passed.');
