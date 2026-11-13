import type { ParityGapAnalysis, ParityGapFinding, RemakeItem } from '@/types/remaker';

type PackFiles = Record<string, string | Uint8Array>;
const objectOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const fileText = (value: string | Uint8Array): string =>
  typeof value === 'string' ? value : new TextDecoder().decode(value);
const parse = (files: PackFiles, path: string): Record<string, unknown> | null => {
  try { return objectOf(JSON.parse(fileText(files[path]))); } catch { return null; }
};
const summarize = (values: string[]): string =>
  `${values.slice(0, 8).join(', ')}${values.length > 8 ? `, +${values.length - 8} more` : ''}`;
const walkStrings = (value: unknown, path: string, visit: (value: string, path: string) => void): void => {
  if (typeof value === 'string') visit(value, path);
  else if (Array.isArray(value)) value.forEach((entry, index) => walkStrings(entry, `${path}[${index}]`, visit));
  else if (value && typeof value === 'object') Object.entries(objectOf(value)).forEach(([key, entry]) => walkStrings(entry, `${path}.${key}`, visit));
};

export function analyzeParityGaps(
  resource: PackFiles,
  behavior: PackFiles,
  _items: RemakeItem[],
  score: number,
): ParityGapAnalysis {
  const findings: ParityGapFinding[] = [];
  const loops = new Map<string, boolean>();
  const expressions = new Set<string>();
  const complex: Array<{ expression: string; target: string }> = [];
  const complexKeys = new Set<string>();
  const attackControllers = new Set<string>();
  const loopingStates = new Set<string>();
  const files = Object.keys(resource).filter((path) => path.endsWith('.json') &&
    (path.startsWith('animations/') || path.startsWith('animation_controllers/') || path.startsWith('particles/')));

  for (const path of files) {
    const parsed = parse(resource, path);
    if (!parsed) continue;
    if (path.startsWith('animations/')) {
      Object.entries(objectOf(parsed.animations)).forEach(([name, def]) => loops.set(name, objectOf(def).loop === true));
    }
    walkStrings(parsed, '', (value, location) => {
      if (!/(?:\bquery\.|\bvariable\.|\bmath\.)/i.test(value)) return;
      expressions.add(`${path}:${value}`);
      if (/math\.(?:sin|cos|pow|sqrt|exp|ln|clamp|lerp|abs|floor|ceil)\s*\(|\?/i.test(value)) {
        const key = `${path}:${location}:${value}`;
        if (!complexKeys.has(key) && complex.length < 6) {
          complexKeys.add(key);
          complex.push({ expression: value, target: `${path}${location}` });
        }
      }
    });
    if (!path.startsWith('animation_controllers/')) continue;

    const mobId = path.replace(/^animation_controllers\/|\.animation_controllers\.json$/g, '');
    const client = parse(resource, `entity/${mobId}.entity.json`);
    const description = objectOf(objectOf(client?.['minecraft:client_entity']).description);
    const aliases = objectOf(description.animations);
    const controllers = objectOf(parsed.animation_controllers);
    for (const controller of Object.values(controllers)) {
      for (const [stateName, stateValue] of Object.entries(objectOf(objectOf(controller).states))) {
        const state = objectOf(stateValue);
        const stateAnimations = Array.isArray(state.animations) ? state.animations : [state.animations];
        const looped = stateAnimations.filter((name): name is string => typeof name === 'string').filter((name) => {
          const resolved = typeof aliases[name] === 'string' ? aliases[name] as string : name;
          return loops.get(resolved) === true;
        });
        const transitions = Array.isArray(state.transitions) ? state.transitions : [];
        for (const transition of transitions) {
          const conditions = Object.values(objectOf(transition)).filter((entry): entry is string => typeof entry === 'string');
          if (conditions.some((expr) => expr.includes('variable.attack_time'))) attackControllers.add(mobId);
          if (looped.length > 0 && conditions.some((expr) => expr.includes('query.all_animations_finished'))) {
            loopingStates.add(`${mobId}/${stateName} (${looped.join(', ')})`);
          }
        }
      }
    }
  }

  const packText = [...Object.values(resource), ...Object.values(behavior)]
    .filter((value): value is string => typeof value === 'string').join('\n');
  const attackWriterExists = /variable\.attack_time\s*=/.test(packText);
  if (attackControllers.size > 0 && !attackWriterExists) {
    findings.push({
      id: 'attack-time-unfed', category: 'molang', severity: 'high', title: 'Attack transition has no visible trigger',
      target: `${attackControllers.size} controllers: ${summarize([...attackControllers])}`,
      expression: 'variable.attack_time > 0',
      evidence: 'The controller reads this variable, but no assignment to variable.attack_time was found in the exported pack.',
      suggestedAction: 'Wire the mob attack event to initialize, set, and clear this variable, or replace it with an event/query that the entity actually drives.',
    });
  }
  if (loopingStates.size > 0) {
    findings.push({
      id: 'looping-animation-transition', category: 'molang', severity: 'high', title: 'Transition waits for looping animations to finish',
      target: `${loopingStates.size} states: ${summarize([...loopingStates])}`,
      expression: 'query.all_animations_finished',
      evidence: 'These states include clips marked loop: true while their exit condition waits for all animations to finish.',
      suggestedAction: 'Use a timed transition or a non-looping one-shot clip for blend states, then verify the handoff in the Bedrock client.',
    });
  }

  const entityPaths = Object.keys(behavior).filter((path) => path.startsWith('entities/') && path.endsWith('.json'));
  const missingBehavior: string[] = [];
  const templateStats: string[] = [];
  for (const path of entityPaths) {
    const entity = objectOf(parse(behavior, path)?.['minecraft:entity']);
    const description = objectOf(entity.description);
    const id = typeof description.identifier === 'string' ? description.identifier.split(':').pop() as string : path.split('/').pop()?.replace(/\.json$/, '') ?? path;
    const components = objectOf(entity.components);
    const componentNames = Object.keys(components);
    const groups = objectOf(entity.component_groups);
    const events = objectOf(entity.events);
    const hasAiOrDamage = componentNames.some((name) => name.startsWith('minecraft:behavior.') || name === 'minecraft:attack' || name === 'minecraft:damage_sensor');
    if (!hasAiOrDamage && Object.keys(groups).length === 0 && Object.keys(events).length === 0) missingBehavior.push(id);
    const health = objectOf(components['minecraft:health']);
    const movement = objectOf(components['minecraft:movement']);
    const box = objectOf(components['minecraft:collision_box']);
    if (health.value === 30 && health.max === 30 && [0.28, 0.35].includes(movement.value as number) && box.width === 0.8 && box.height === 1) {
      templateStats.push(`${id} (health 30, speed ${String(movement.value)}, box 0.8×1.0)`);
    }
  }
  if (missingBehavior.length > 0) findings.push({
    id: 'entity-ai-not-defined', category: 'entity', severity: 'high', title: 'Spawnable entities have no defined AI or state events',
    target: `${missingBehavior.length} entities: ${summarize(missingBehavior)}`,
    evidence: 'Their emitted definitions contain no minecraft:behavior.*, attack/damage component, component group, or entity event.',
    suggestedAction: 'For each entity, compare Java goals and event/state logic; add the intended target, navigation, attack, damage, loot, and phase behavior rather than assuming a generic mob profile.',
  });
  if (templateStats.length > 0) findings.push({
    id: 'entity-template-stats', category: 'entity', severity: 'medium', title: 'Entity stats match the generated fallback profile',
    target: `${templateStats.length} entities: ${summarize(templateStats)}`,
    evidence: 'These exported entities use the same 30-health profile, name-derived movement speeds, and 0.8×1.0 collision box; the simulator does not compare these values with Java source stats.',
    suggestedAction: 'Tune max health, movement speed, hitbox, knockback resistance, and drops per mob using the source mod or an in-game comparison.',
  });
  complex.forEach((item, index) => findings.push({
    id: `complex-molang-${index + 1}`, category: 'molang', severity: 'review', title: 'Complex Molang needs a semantic spot-check',
    target: item.target, expression: item.expression,
    evidence: 'Structural validation checks JSON and expression shape, not that math units, curve timing, or results match the Java animation in live Bedrock.',
    suggestedAction: 'Compare this expression with its source animation and tune units, ranges, and timing in the Bedrock client.',
  }));

  return {
    fidelityScore: score, uncoveredPercent: Math.max(0, 100 - score), inspectedEntities: entityPaths.length,
    inspectedMolangExpressions: expressions.size, findings,
  };
}