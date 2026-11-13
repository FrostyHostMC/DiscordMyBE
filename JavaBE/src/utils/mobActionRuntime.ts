import type { MobBehaviorProfile } from '@/utils/mobBehaviorProfiles';

export function buildMobActionRuntimeScript(
  modId: string,
  profiles: Record<string, MobBehaviorProfile>,
): string {
  const actions = Object.fromEntries(Object.entries(profiles)
    .filter(([, profile]) => profile.areaOfEffect || profile.charge || profile.statusEffect)
    .map(([mobId, profile]) => [`${modId}:${mobId}`, {
      areaOfEffect: profile.areaOfEffect,
      charge: profile.charge,
      statusEffect: profile.statusEffect,
    }]));
  if (Object.keys(actions).length === 0) return '';
  return `
// Source-signature mob action handlers; only registered ported entities are included.
const MOB_ACTIONS = ${JSON.stringify(actions)};
function applyMobHitAction(initialAttacker, target) {
  let attacker = initialAttacker;
  if (!attacker || !target) return;
  try {
    const projectile = attacker.getComponent('minecraft:projectile');
    if (projectile && projectile.owner) attacker = projectile.owner;
  } catch {}
  const action = MOB_ACTIONS[attacker.typeId];
  if (!action) return;
  if (action.areaOfEffect) {
    try {
      const center = target.location;
      target.dimension.spawnParticle('minecraft:critical_hit_emitter', center);
      let affected = 0;
      for (const nearby of target.dimension.getEntities({ location: center, maxDistance: 3 })) {
        if (nearby.id === target.id || nearby.id === attacker.id || nearby.typeId === attacker.typeId) continue;
        try { nearby.applyDamage(3); affected++; } catch {}
        if (affected >= 8) break;
      }
    } catch {}
  }
  if (action.charge) {
    try {
      const dx = target.location.x - attacker.location.x;
      const dz = target.location.z - attacker.location.z;
      const length = Math.max(0.01, Math.sqrt(dx * dx + dz * dz));
      target.applyKnockback(dx / length, dz / length, 1.4, 0.25);
    } catch {}
  }
  if (action.statusEffect) {
    try { target.addEffect(action.statusEffect, 60, { amplifier: 0, showParticles: true }); } catch {}
  }
}

world.afterEvents.entityHitEntity.subscribe((event) => {
  applyMobHitAction(event.damagingEntity, event.hitEntity);
});

if (world.afterEvents.projectileHitEntity) {
  world.afterEvents.projectileHitEntity.subscribe((event) => {
    let attacker = event.source;
    if (!attacker) {
      try {
        attacker = event.projectile.getComponent('minecraft:projectile')?.owner;
      } catch {}
    }
    const hit = event.getEntityHit();
    applyMobHitAction(attacker, hit?.entity);
  });
}
`;
}