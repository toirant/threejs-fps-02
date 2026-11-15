// Hitscan combat and grenades. One shared raycaster, reused vectors, no
// allocation in the hot path: a shot is one ray against the world and the
// fighters' body-part meshes, and damage is head > torso > legs.
import * as THREE from 'three';

const PART_MULT = { head: 3.5, torso: 1, legs: 0.75 };

export function createCombat(scene, effects, audio) {
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  // origin/direction are the shot line; meshes are world + body parts.
  // Returns { point, normal, bot, part, mesh } or null.
  // skipTeam: a shot never hurts its own side — a teammate's body, or the
  // player when the shooter is Ember, is passed through and the next
  // surface behind it is what the bullet meets.
  function raycastShot(ox, oy, oz, dx, dy, dz, maxDist, meshes, skipTeam = null) {
    origin.set(ox, oy, oz);
    direction.set(dx, dy, dz).normalize();
    raycaster.set(origin, direction);
    raycaster.far = maxDist;
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    let hit = null;
    for (const h of hits) {
      const b = h.object.userData.bot;
      // A downed fighter's fallen body never stops a bullet.
      if (b && !b.alive) continue;
      if (skipTeam && b && b.team === skipTeam) continue;
      if (skipTeam === 'ember' && h.object.userData.isPlayer) continue;
      hit = h;
      break;
    }
    if (!hit) return null;
    const face = hit.face;
    return {
      point: hit.point.clone(),
      normal: face ? face.normal.clone().transformDirection(hit.object.matrixWorld) : up.clone(),
      bot: hit.object.userData.bot ?? null,
      part: hit.object.userData.part ?? null,
      mesh: hit.object,
      distance: hit.distance,
    };
  }

  // Damage a fighter: armour soaks half until it breaks, then health. Head
  // shots multiply. Returns 'hit' | 'kill'.
  function damageFighter(fighter, base, part) {
    if (!fighter.alive) return 'hit';
    const mult = PART_MULT[part] ?? 1;
    let amount = base * mult;
    if (fighter.armor > 0) {
      const soaked = Math.min(fighter.armor, amount * 0.5);
      fighter.armor -= soaked;
      amount -= soaked;
    }
    fighter.hp -= amount;
    if (fighter.hp <= 0) {
      fighter.hp = 0;
      fighter.alive = false;
      return 'kill';
    }
    return 'hit';
  }

  // ---- Grenades: thrown bodies with gravity, one bounce, then a fuse. ----
  const grenades = [];
  for (let i = 0; i < 6; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#2c323a'), roughness: 0.6, metalness: 0.4 }),
    );
    mesh.visible = false;
    scene.add(mesh);
    grenades.push({ mesh, active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0, type: 'frag', owner: null });
  }
  let next = 0;

  function throwGrenade(from, dir, type, owner) {
    const g = grenades[next];
    next = (next + 1) % grenades.length;
    g.active = true;
    g.type = type;
    g.owner = owner;
    g.pos.copy(from);
    g.vel.copy(dir).multiplyScalar(13).add(new THREE.Vector3(0, 4.5, 0));
    g.fuse = type === 'frag' ? 1.6 : 1.1;
    g.mesh.visible = true;
    g.mesh.position.copy(g.pos);
  }

  // Step grenades; onExplode(point, owner) and onSmoke(point) are round hooks.
  function stepGrenades(dt, colliders, onExplode, onSmoke) {
    for (const g of grenades) {
      if (!g.active) continue;
      g.vel.y -= 14 * dt;
      g.pos.addScaledVector(g.vel, dt);
      g.mesh.position.copy(g.pos);
      if (g.pos.y < 0.09) {
        g.pos.y = 0.09;
        g.vel.y = Math.abs(g.vel.y) * 0.35;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }
      for (const c of colliders) {
        if (g.pos.x > c.min.x - 0.09 && g.pos.x < c.max.x + 0.09
          && g.pos.y > c.min.y - 0.09 && g.pos.y < c.max.y + 0.09
          && g.pos.z > c.min.z - 0.09 && g.pos.z < c.max.z + 0.09) {
          g.vel.multiplyScalar(-0.3);
          g.pos.addScaledVector(g.vel, dt * 2);
        }
      }
      g.fuse -= dt;
      if (g.fuse <= 0) {
        g.active = false;
        g.mesh.visible = false;
        if (g.type === 'frag') onExplode(g.pos, g.owner);
        else onSmoke(g.pos);
      }
    }
  }

  return { raycastShot, damageFighter, throwGrenade, stepGrenades, grenades };
}
